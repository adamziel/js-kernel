import type {
	Node,
	NodeKind,
	NodeOf,
	CommandNode,
	FunctionCallNode,
	PipelineNode,
	ListNode,
	Redirect,
	RedirectKind,
} from './ast.ts';
import type {
	MessagePortReadableStream,
	MessagePortWritableStream,
} from '../ipc/message-port.ts';
import type { StdioMode } from '../process/spawn-options.ts';
import { joinPaths, normalizePath } from '../util/paths.ts';

interface ChildProcessHandle {
	pid: number;
	stdin?: MessagePortWritableStream;
	stdout?: MessagePortReadableStream;
	stderr?: MessagePortReadableStream;
	onExit(listener: (code: number) => void): void;
	offExit(listener: (code: number) => void): void;
	kill(): void;
	readonly exitCode: number | null;
}

interface ProcessControllerLike {
	spawn(options: {
		argv: string[];
		env?: Record<string, string>;
		cwd?: string;
		name?: string;
		debug?: boolean;
		stdio?: { stdin?: StdioMode; stdout?: StdioMode; stderr?: StdioMode };
		timeout?: number;
	}): Promise<ChildProcessHandle>;
	getAllEnv(): Record<string, string>;
	cwd(): string;
	chdir?(path: string): void;
	stdout?: MessagePortWritableStream;
	stderr?: MessagePortWritableStream;
	fsSync: {
		readFileSync(path: string, encoding?: string): Uint8Array | string;
		writeFileSync(path: string, data: Uint8Array | string): void;
		appendFileSync(path: string, data: Uint8Array | string): void;
		existsSync(path: string): boolean;
		readdirSync(path: string): string[];
		statSync(path: string): {
			isDirectory(): boolean;
			isFile(): boolean;
		};
	};
}

const hasKind = <K extends NodeKind>(node: Node, kind: K): node is NodeOf<K> =>
	Object.prototype.hasOwnProperty.call(node, kind);

const getNodeKind = (node: Node): NodeKind => Object.keys(node)[0] as NodeKind;

const isCommandLike = (node: Node): node is CommandNode | FunctionCallNode =>
	hasKind(node, 'Command') || hasKind(node, 'FunctionCall');

const firstRedirect = (
	redirects: Redirect[] | undefined,
	kind: RedirectKind
): Redirect | undefined => redirects?.find((r) => r.kind === kind);

const toUint8 = (data: string | Uint8Array): Uint8Array =>
	typeof data === 'string' ? new TextEncoder().encode(data) : data;

const fromUint8 = (data: Uint8Array): string => new TextDecoder().decode(data);

const waitForExit = (child: ChildProcessHandle): Promise<number> =>
	new Promise((resolve) => {
		if (typeof child.exitCode === 'number') {
			resolve(child.exitCode);
			return;
		}
		const handler = (code: number) => {
			child.offExit(handler);
			resolve(code);
		};
		child.onExit(handler);
	});

const pump = (
	readable: MessagePortReadableStream,
	writable: MessagePortWritableStream
): Promise<void> =>
	new Promise((resolve) => {
		const onData = (chunk: Uint8Array | string) => {
			writable.write(chunk);
		};
		const onEnd = () => {
			writable.end();
			cleanup();
			resolve();
		};
		const onClose = () => {
			cleanup();
			resolve();
		};
		const cleanup = () => {
			readable.off('data' as any, onData as any);
			readable.off('end' as any, onEnd as any);
			readable.off('close' as any, onClose as any);
		};
		readable.on('data' as any, onData as any);
		readable.once('end' as any, onEnd as any);
		readable.once('close' as any, onClose as any);
	});

const hasGlobChar = (value: string): boolean => /[*?]/.test(value);

const escapeRegex = (segment: string): string =>
	segment.replace(/[.+^${}()|[\]\\]/g, '\\$&');

const segmentToRegex = (segment: string): RegExp => {
	let pattern = '^';
	for (let index = 0; index < segment.length; index += 1) {
		const char = segment[index];
		if (char === '*') {
			pattern += '.*';
		} else if (char === '?') {
			pattern += '.';
		} else {
			pattern += escapeRegex(char);
		}
	}
	pattern += '$';
	return new RegExp(pattern);
};

const joinDisplayPath = (parts: string[], isAbsolute: boolean): string => {
	if (isAbsolute) {
		return `/${parts.join('/')}`.replace(/\/{2,}/g, '/');
	}
	return parts.join('/');
};

const expandGlobPattern = (
	pc: ProcessControllerLike,
	pattern: string,
	cwd: string
): string[] => {
	if (!pattern) {
		return [];
	}

	const isAbsolute = pattern.startsWith('/');
	const baseDir = normalizePath(isAbsolute ? '/' : cwd || '/');

	const rawSegments = pattern.split('/');
	const segments =
		rawSegments.length && rawSegments[0] === ''
			? rawSegments.slice(1)
			: rawSegments;
	const requiresDirectory = pattern.endsWith('/');
	const filteredSegments = segments.filter((segment) => segment.length > 0);

	if (filteredSegments.length === 0) {
		return [pattern];
	}

	const results: string[] = [];

	const walk = (
		currentAbs: string,
		displayParts: string[],
		index: number
	) => {
		if (index >= filteredSegments.length) {
			const output = joinDisplayPath(displayParts, isAbsolute);
			if (output.length > 0) {
				results.push(output);
			}
			return;
		}

		const segment = filteredSegments[index];
		const isLast = index === filteredSegments.length - 1;
		const allowHidden = segment.startsWith('.');

		if (!hasGlobChar(segment)) {
			const nextAbs = normalizePath(
				segment.startsWith('/')
					? segment
					: joinPaths(currentAbs || '/', segment)
			);
			let stats;
			try {
				stats = pc.fsSync.statSync(nextAbs);
			} catch {
				return;
			}

			if (isLast) {
				if (!requiresDirectory || stats.isDirectory()) {
					const nextDisplay = [...displayParts, segment].filter(
						(part) => part.length > 0
					);
					let output = joinDisplayPath(nextDisplay, isAbsolute);
					if (requiresDirectory && stats.isDirectory()) {
						output = output.endsWith('/') ? output : `${output}/`;
					}
					if (output.length > 0) {
						results.push(output);
					}
				}
				return;
			}

			if (!stats.isDirectory()) {
				return;
			}

			const nextDisplay = [...displayParts, segment].filter(
				(part) => part.length > 0
			);
			walk(nextAbs, nextDisplay, index + 1);
			return;
		}

		let entries: string[];
		try {
			entries = pc.fsSync.readdirSync(currentAbs || '/');
		} catch {
			return;
		}

		const matcher = segmentToRegex(segment);
		const sortedEntries = [...entries].sort((a, b) =>
			a.localeCompare(b)
		);

		for (const entry of sortedEntries) {
			if (entry === '.' || entry === '..') {
				continue;
			}
			if (!allowHidden && entry.startsWith('.')) {
				continue;
			}
			if (!matcher.test(entry)) {
				continue;
			}
			const nextAbs = normalizePath(
				currentAbs === '/'
					? `/${entry}`
					: joinPaths(currentAbs || '/', entry)
			);
			let stats;
			try {
				stats = pc.fsSync.statSync(nextAbs);
			} catch {
				continue;
			}

			if (isLast) {
				if (requiresDirectory && !stats.isDirectory()) {
					continue;
				}
				const nextDisplay = [...displayParts, entry].filter(
					(part) => part.length > 0
				);
				let output = joinDisplayPath(nextDisplay, isAbsolute);
				if (requiresDirectory && stats.isDirectory()) {
					output = output.endsWith('/') ? output : `${output}/`;
				}
				if (output.length > 0) {
					results.push(output);
				}
				continue;
			}

			if (!stats.isDirectory()) {
				continue;
			}

			const nextDisplay = [...displayParts, entry].filter(
				(part) => part.length > 0
			);
			walk(nextAbs, nextDisplay, index + 1);
		}
	};

	walk(baseDir, isAbsolute ? [] : [], 0);
	return results.sort((a, b) => a.localeCompare(b));
};

const expandArgumentWithGlob = (
	pc: ProcessControllerLike,
	arg: string,
	cwd: string
): string[] => {
	if (!hasGlobChar(arg)) {
		return [arg];
	}
	const matches = expandGlobPattern(pc, arg, cwd);
	return matches.length > 0 ? matches : [arg];
};

const expandArguments = (
	pc: ProcessControllerLike,
	args: string[],
	cwd: string
): string[] => {
	const expanded: string[] = [];
	for (const arg of args) {
		if (typeof arg !== 'string') {
			expanded.push(String(arg));
			continue;
		}
		const parts = expandArgumentWithGlob(pc, arg, cwd);
		expanded.push(...parts);
	}
	return expanded;
};

async function runCommand(
	pc: ProcessControllerLike,
	node: CommandNode | FunctionCallNode
): Promise<number> {
	const isSimpleCommand = hasKind(node, 'Command');
	const payload = isSimpleCommand ? node.Command : node.FunctionCall;
	const env = pc.getAllEnv();
	const cwd = pc.cwd();
	const expandedArgs = expandArguments(
		pc,
		payload.args.map((arg) => String(arg)),
		cwd
	);
	const argv = [payload.name, ...expandedArgs];

	if (payload.name === 'cd' && typeof pc.chdir === 'function') {
		const targetArg = payload.args[0];
		const home = env.HOME || '/';
		const rawTarget =
			typeof targetArg === 'string' && targetArg.length > 0
				? targetArg
				: home;
		const resolved = normalizePath(
			rawTarget.startsWith('/')
				? rawTarget
				: joinPaths(cwd || '/', rawTarget || '.')
		);

		if (!pc.fsSync.existsSync(resolved)) {
			pc.stderr?.write(`cd: no such file or directory: ${rawTarget}\n`);
			return 1;
		}

		pc.chdir(resolved);
		return 0;
	}

	const inputRedirect = firstRedirect(payload.redirects, 'Input');
	const outputRedirect = firstRedirect(payload.redirects, 'Output');
	const appendRedirect = firstRedirect(payload.redirects, 'Append');
	const wantsStdoutPipe = Boolean(outputRedirect || appendRedirect);

	const child = await pc.spawn({
		argv,
		env,
		cwd,
		name: payload.name,
		stdio: {
			stdin: inputRedirect ? 'pipe' : undefined,
			stdout: wantsStdoutPipe ? 'pipe' : undefined,
		},
	});

	// Handle input redirection: < file
	if (inputRedirect && child.stdin) {
		const inputPath = inputRedirect.file;
		const data = pc.fsSync.readFileSync(inputPath) as Uint8Array;
		child.stdin.write(data);
		child.stdin.end();
	}

	// Handle output redirection: > file, >> file
	if (wantsStdoutPipe && child.stdout) {
		const target = (outputRedirect ?? appendRedirect)!.file;
		if (outputRedirect) {
			// Truncate behavior
			pc.fsSync.writeFileSync(target, new Uint8Array(0));
		}
		await new Promise<void>((resolve) => {
			child.stdout!.on('data' as any, (chunk: Uint8Array | string) => {
				pc.fsSync.appendFileSync(target, toUint8(chunk as any));
			});
			child.stdout!.once('end' as any, () => resolve());
			child.stdout!.once('close' as any, () => resolve());
		});
	}

	return await waitForExit(child);
}

async function runPipeline(
	pc: ProcessControllerLike,
	pipelineNode: PipelineNode
): Promise<number> {
	const pipeline = pipelineNode.Pipeline;
	if (pipeline.commands.length === 0) return 0;

	// Spawn each stage with appropriate stdio
	const stages = pipeline.commands;
	const handles: ChildProcessHandle[] = [];

	for (let index = 0; index < stages.length; index += 1) {
		const stage = stages[index];
		if (!isCommandLike(stage)) {
			throw new Error('Unsupported pipeline stage');
		}
		const stagePayload = hasKind(stage, 'Command')
			? stage.Command
			: stage.FunctionCall;
		const isLast = index === stages.length - 1;
		const argv = [stagePayload.name, ...stagePayload.args];
		const env = pc.getAllEnv();
		const cwd = pc.cwd();

		const outputRedirect = firstRedirect(stagePayload.redirects, 'Output');
		const appendRedirect = firstRedirect(stagePayload.redirects, 'Append');
		const wantsFileRedirect = Boolean(outputRedirect || appendRedirect);

		const handle = await pc.spawn({
			argv,
			env,
			cwd,
			name: stagePayload.name,
			stdio: {
				stdin: index === 0 ? undefined : 'pipe',
				stdout: 'pipe',
			},
		});
		handles.push(handle);
	}

	// Wire the pipes between consecutive stages
	const pumps: Promise<void>[] = [];
	for (let i = 0; i < handles.length - 1; i += 1) {
		const left = handles[i];
		const right = handles[i + 1];
		if (left.stdout && right.stdin) {
			pumps.push(pump(left.stdout, right.stdin));
		}
	}

	// Handle possible redirection on the last stage
	const lastNode = stages[stages.length - 1];
	if (isCommandLike(lastNode)) {
		const lastPayload = hasKind(lastNode, 'Command')
			? lastNode.Command
			: lastNode.FunctionCall;
		const outputRedirect = firstRedirect(lastPayload.redirects, 'Output');
		const appendRedirect = firstRedirect(lastPayload.redirects, 'Append');
		const wantsFileRedirect = Boolean(outputRedirect || appendRedirect);
		const lastHandle = handles[handles.length - 1];
		if (lastHandle.stdout) {
			if (wantsFileRedirect) {
				const target = (outputRedirect ?? appendRedirect)!.file;
				if (outputRedirect) {
					pc.fsSync.writeFileSync(target, new Uint8Array(0));
				}
				pumps.push(
					new Promise<void>((resolve) => {
						lastHandle.stdout!.on(
							'data' as any,
							(chunk: Uint8Array | string) => {
								pc.fsSync.appendFileSync(
									target,
									toUint8(chunk as any)
								);
							}
						);
						lastHandle.stdout!.once('end' as any, () => resolve());
						lastHandle.stdout!.once('close' as any, () =>
							resolve()
						);
					})
				);
			} else {
				const parentStdout = pc.stdout;
				if (parentStdout) {
					pumps.push(pump(lastHandle.stdout, parentStdout));
				} else {
					const consoleDecoder = new TextDecoder();
					pumps.push(
						new Promise<void>((resolve) => {
							lastHandle.stdout!.on(
								'data' as any,
								(chunk: Uint8Array | string) => {
									const text =
										typeof chunk === 'string'
											? chunk
											: consoleDecoder.decode(
													chunk as Uint8Array
											  );
									console.log(text);
								}
							);
							const finish = () => resolve();
							lastHandle.stdout!.once('end' as any, finish);
							lastHandle.stdout!.once('close' as any, finish);
						})
					);
				}
			}
		}
	}

	await Promise.all(pumps);
	const exitCodes = await Promise.all(handles.map((h) => waitForExit(h)));
	return exitCodes[exitCodes.length - 1] ?? 0;
}

async function runList(
	pc: ProcessControllerLike,
	listNode: ListNode
): Promise<number> {
	const list = listNode.List;
	let last = 0;
	for (const stmt of list.statements) {
		if (hasKind(stmt, 'List')) {
			last = await runList(pc, stmt);
		} else if (hasKind(stmt, 'Pipeline')) {
			last = await runPipeline(pc, stmt);
		} else if (isCommandLike(stmt)) {
			last = await runCommand(pc, stmt);
		} else if (hasKind(stmt, 'Comment')) {
			continue;
		} else {
			throw new Error(
				`Unsupported node in simple runner: ${getNodeKind(stmt)}`
			);
		}
	}
	return last;
}

export async function runShellScript(
	pc: ProcessControllerLike,
	root: Node
): Promise<number> {
	if (hasKind(root, 'List')) {
		return runList(pc, root);
	}
	if (hasKind(root, 'Pipeline')) {
		return runPipeline(pc, root);
	}
	if (isCommandLike(root)) {
		return runCommand(pc, root);
	}
	throw new Error(
		`Only simple commands, pipelines, and lists are supported, got: ${getNodeKind(
			root
		)}`
	);
}
