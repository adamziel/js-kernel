import { InMemoryFileSystem } from '../fs/in-memory/filesystem.ts';
import { joinPaths } from '../util/paths.ts';
import {
	type KernelStdioChunk,
	MessagePortReadableStream,
	MessagePortWritableStream,
} from '../ipc/message-port.ts';
import { createProcessWorker } from '../process/worker-factory.ts';
import {
	CONTROL_MESSAGE_CHILD_EXIT,
	CONTROL_MESSAGE_HOST_KILL_CHILD,
	CONTROL_MESSAGE_KILL_REQUEST,
	CONTROL_MESSAGE_KILL_RESULT,
	CONTROL_MESSAGE_PROCESS_EXIT,
	CONTROL_MESSAGE_REPORT_CHILD_EXIT,
	CONTROL_MESSAGE_SPAWN_REQUEST,
	CONTROL_MESSAGE_SPAWN_RESULT,
	CONTROL_MESSAGE_FS_REQUEST,
	CONTROL_MESSAGE_FS_RESPONSE,
	CONTROL_MESSAGE_SPAWN_SYNC_REQUEST,
	CONTROL_MESSAGE_SPAWN_SYNC_RESPONSE,
	CONTROL_MESSAGE_STDIN_DATA,
} from '../process/constants.ts';
import {
	normalizeSpawnOptions,
	type NormalizedSpawnOptions,
	type SpawnStdioOptions,
	type StdioMode,
} from '../process/spawn-options.ts';
import {
	createSpawnSyncClient,
	type SpawnSyncClient,
	type SpawnSyncOutcome,
} from '../process/spawn-sync/client.ts';
import { serializeFsResponse, serializeFsError } from '../fs/serialization.ts';

export type { StdioMode, SpawnStdioOptions } from '../process/spawn-options.ts';
export type { SpawnSyncOutcome } from '../process/spawn-sync/client.ts';
export type { KernelStdioChunk } from '../ipc/message-port.ts';

export interface SpawnOptions {
	argv: string[];
	env: Record<string, string>;
	cwd: string;
	name: string;
	debug?: boolean;
	stdio?: SpawnStdioOptions;
	ipcPort?: MessagePort | null;
	workerThreadId?: number;
	workerThreadName?: string;
	timeout?: number;
	input?: unknown;
}

export const enum ExitCode {
	OK = 0,
	ERROR = 1,
	NOT_FOUND = 127,
}

type ExitListener = (code: number) => void;

interface PreparedStdioResource {
	fd: 0 | 1 | 2;
	mode: StdioMode;
	workerPort?: MessagePort;
	hostPort?: MessagePort;
}

interface PreparedSpawnResources {
	pid: number;
	programPath: string;
	programSource: string;
	stdio: PreparedStdioResource[];
	control: {
		kernelPort: MessagePort;
		processPort: MessagePort;
	};
	fs: {
		kernelPort: MessagePort;
		processPort: MessagePort;
	};
	spawnSync: {
		kernelPort: MessagePort;
		processPort: MessagePort;
	};
	message?: {
		parentPort: MessagePort | null;
		workerPort: MessagePort | null;
	};
}

interface KernelProcessRecord {
	pid: number;
	parentPid: number | null;
	name: string;
	controlPort: MessagePort;
	fsPort: MessagePort;
	spawnSyncPort: MessagePort;
	messagePort?: MessagePort | null;
	threadId?: number;
	threadName?: string;
	children: Set<number>;
	hostType: 'kernel' | 'process';
	hostPid: number | null;
	worker?: Worker;
	exitCode: number | null;
	exitListeners?: Set<ExitListener>;
	stdio?: {
		stdin?: MessagePortWritableStream;
		stdout?: MessagePortReadableStream;
		stderr?: MessagePortReadableStream;
	};
	stdinRelayPort?: MessagePort | null;  // For nested spawns: kernel relays stdin from parent to child
	controlCleanup: () => void;
	fsCleanup: () => void;
	spawnSyncCleanup: () => void;
	setExitCode?: (code: number) => void;
	logPrefix?: string;
}

interface KernelStdinState {
	buffer: Uint8Array;
	closed: boolean;
	waitBuffer: SharedArrayBuffer | null;
	waitView: Int32Array | null;
}

export interface KernelSubprocessExtras {
	pid: number;
	stdin?: MessagePortWritableStream;
	stdout?: MessagePortReadableStream;
	stderr?: MessagePortReadableStream;
	messagePort?: MessagePort | null;
	threadId?: number;
	threadName?: string;
	onExit(listener: ExitListener): void;
	offExit(listener: ExitListener): void;
	kill(): void;
	readonly exitCode: number | null;
}

export type KernelSubprocess = Worker & KernelSubprocessExtras;

export class Kernel extends InMemoryFileSystem {
	private env: Record<string, string> = {
		PATH: '/bin',
	};

	private readonly textEncoder = new TextEncoder();
	private pidCounter = 1;
	private readonly processes = new Map<number, KernelProcessRecord>();
	private readonly textDecoder = new TextDecoder();
	// Global filesystem operation queue to ensure sequential execution across all processes
	private fsQueue = Promise.resolve();
	private activeFsProcessRecord: KernelProcessRecord | null = null;
	private readonly stdinStates = new Map<number, KernelStdinState>();
	private readonly stdinWaitTimeoutMs = 1000;
	private readonly hostRecord: KernelProcessRecord;
	private readonly hostSpawnSyncClient: SpawnSyncClient | null;
	private readonly hostSpawnSyncCleanup: (() => void) | null;
	private readonly atomicsWaitAllowed: boolean;

	constructor() {
		super();

		const hostControlChannel = new MessageChannel();
		const hostFsChannel = new MessageChannel();
		const hostSpawnSyncChannel = new MessageChannel();

		this.hostRecord = {
			pid: 0,
			parentPid: null,
			name: '__kernel_host__',
			controlPort: hostControlChannel.port1,
			fsPort: hostFsChannel.port1,
			spawnSyncPort: hostSpawnSyncChannel.port1,
			messagePort: null,
			children: new Set<number>(),
			hostType: 'kernel',
			hostPid: null,
			exitCode: null,
			controlCleanup: () => undefined,
			fsCleanup: () => undefined,
			spawnSyncCleanup: () => undefined,
			stdinRelayPort: null,
		};
		this.processes.set(this.hostRecord.pid, this.hostRecord);
		hostControlChannel.port1.start?.();
		hostFsChannel.port1.start?.();
		hostSpawnSyncChannel.port1.start?.();

		this.atomicsWaitAllowed = this.detectAtomicsWaitAllowed();
		if (this.atomicsWaitAllowed) {
			this.hostSpawnSyncCleanup = this.installProcessSpawnSync(
				this.hostRecord
			);
			this.hostSpawnSyncClient = createSpawnSyncClient(
				hostSpawnSyncChannel.port2
			);
		} else {
			hostSpawnSyncChannel.port2.close();
			this.hostSpawnSyncCleanup = null;
			this.hostSpawnSyncClient = null;
		}
	}

	setEnv(key: string, value: string) {
		this.env[key] = value;
	}

	getEnv(key: string) {
		return this.env[key] || '';
	}

	private loadProgram(command: string, cwd: string) {
		const executablePath = this.resolveExecutable(command, cwd);
		if (!executablePath) {
			return null;
		}
		const programSource = this.readFileSync(executablePath, 'utf8');
		return { executablePath, programSource };
	}

	private normalizeSpawnSyncInput(
		input: unknown
	): KernelStdioChunk | undefined {
		if (input === null || typeof input === 'undefined') {
			return undefined;
		}
		if (typeof input === 'string') {
			return input;
		}
		if (input instanceof Uint8Array) {
			return input.slice();
		}
		if (typeof ArrayBuffer !== 'undefined') {
			if (input instanceof ArrayBuffer) {
				return new Uint8Array(input);
			}
			if (ArrayBuffer.isView(input)) {
				const view = input as ArrayBufferView;
				return new Uint8Array(
					view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
				);
			}
		}
		if (
			typeof input === 'object' &&
			input !== null &&
			'length' in (input as { length?: unknown }) &&
			typeof (input as { length?: unknown }).length === 'number'
		) {
			try {
				return new Uint8Array(input as ArrayLike<number>);
			} catch {
				// fall through to string conversion
			}
		}
		return String(input);
	}

	private detectAtomicsWaitAllowed(): boolean {
		try {
			if (
				typeof Atomics !== 'object' ||
				typeof Atomics.wait !== 'function' ||
				typeof SharedArrayBuffer !== 'function'
			) {
				return false;
			}
			const buffer = new SharedArrayBuffer(4);
			const view = new Int32Array(buffer);
			Atomics.wait(view, 0, 0, 0);
			return true;
		} catch {
			return false;
		}
	}

	private transformProgramSourceForInlineExecution(source: string): string {
		let transformed = source.replace(/^#!.*(?:\n|$)/, '');
		transformed = transformed.replace(
			/export\s+default\s+async\s+function\s*(\w*)\s*\(/g,
			'exports.default = function $1('
		);
		transformed = transformed.replace(
			/export\s+default\s+function\s*(\w*)\s*\(/g,
			'exports.default = function $1('
		);
		transformed = transformed.replace(
			/export\s+default\s+/g,
			'exports.default = '
		);
		return transformed;
	}

	private getDirname(path: string): string {
		if (!path || path === '/') {
			return '/';
		}
		const segments = path.split('/');
		segments.pop();
		const dir = segments.join('/');
		return dir.length > 0 ? dir : '/';
	}

	private convertChunkToString(chunk: KernelStdioChunk): string {
		return typeof chunk === 'string'
			? chunk
			: this.textDecoder.decode(chunk);
	}

	resolveExecutable(path: string, cwd: string) {
		if (path.includes('/')) {
			if (!path.startsWith('/')) {
				path = joinPaths(cwd, path);
			}
			if (!this.existsSync(path)) {
				throw new Error(`Executable not found: ${path}`);
			}
			return path;
		}
		const paths = this.getEnv('PATH').split(':');
		for (const executablesRoot of paths) {
			const executable = joinPaths(executablesRoot, path);
			if (this.existsSync(executable)) {
				return executable;
			}
		}
		return null;
	}

	spawn(options: SpawnOptions): KernelSubprocess | ExitCode {
		const program = this.loadProgram(options.argv[0], options.cwd);
		if (!program) {
			return ExitCode.NOT_FOUND;
		}

		const resources = this.prepareSpawnResources(
			options,
			program,
			null /* parentPid */
		);

		return this.createKernelHostedProcess(options, program, resources);
	}

	spawnSync(
		rawOptions: SpawnOptions & { input?: unknown }
	): SpawnSyncOutcome {
		const normalized = normalizeSpawnOptions(rawOptions, {
			env: this.env,
			cwd:
				typeof rawOptions.cwd === 'string' && rawOptions.cwd.length > 0
					? rawOptions.cwd
					: '/',
			debug: rawOptions.debug,
		});
		if (!normalized) {
			throw new Error('Invalid spawn options');
		}

		const timeoutMs =
			typeof normalized.timeout === 'number' && normalized.timeout >= 0
				? normalized.timeout
				: 5000;

		const stdio: SpawnStdioOptions = {
			stdin: rawOptions.stdio?.stdin ?? 'pipe',
			stdout: rawOptions.stdio?.stdout ?? 'pipe',
			stderr: rawOptions.stdio?.stderr ?? 'pipe',
		};

		const spawnRequest: Record<string, unknown> = {
			...normalized,
			stdio,
		};
		const initialInput = this.normalizeSpawnSyncInput(rawOptions.input);
		if (typeof initialInput !== 'undefined') {
			spawnRequest.input = initialInput;
		}

		if (this.hostSpawnSyncClient) {
			return this.hostSpawnSyncClient.run(spawnRequest, timeoutMs);
		}

		return this.executeSpawnSyncInline(normalized, stdio, initialInput);
	}

	private executeSpawnSyncInline(
		options: NormalizedSpawnOptions,
		stdio: SpawnStdioOptions,
		stdinInput?: KernelStdioChunk
	): SpawnSyncOutcome {
		const program = this.loadProgram(options.argv[0], options.cwd);
		if (!program) {
			return {
				status: null,
				error: `Command not found: ${options.argv[0]}`,
			};
		}

		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		let exitStatus: number | null = 0;
		let exited = false;

		let stdinConsumed = false;
		const clonedInput = typeof stdinInput === 'string'
			? stdinInput
			: stdinInput instanceof Uint8Array
			? stdinInput.slice()
			: undefined;

		const stdin = {
			read: (): KernelStdioChunk | null => {
				if (stdinConsumed) {
					return null;
				}
				stdinConsumed = true;
				if (typeof clonedInput === 'string') {
					return clonedInput;
				}
				if (clonedInput instanceof Uint8Array) {
					return clonedInput;
				}
				return null;
			},
		};

		const writeChunk = (
			chunks: string[],
			mode: StdioMode | undefined,
			chunk: KernelStdioChunk
		) => {
			if (mode !== 'pipe') {
				return;
			}
			const text = this.convertChunkToString(chunk);
			chunks.push(text);
		};

		const stdout = {
			write: (chunk: KernelStdioChunk) => writeChunk(stdoutChunks, stdio.stdout, chunk),
		};

		const stderr = {
			write: (chunk: KernelStdioChunk) => writeChunk(stderrChunks, stdio.stderr, chunk),
		};

		const processController = {
			stdin,
			stdout,
			stderr,
			spawnSync: (childOptions: SpawnOptions & { input?: unknown }) =>
				this.spawnSync(childOptions),
			exit: (code?: number) => {
				exitStatus =
					typeof code === 'number' && Number.isFinite(code)
						? Math.trunc(code)
						: 0;
				exited = true;
			},
		};

		try {
			const transformedSource =
				this.transformProgramSourceForInlineExecution(
					program.programSource
				);
			const exports: Record<string, unknown> = {};
			const module = { exports } as { exports: Record<string, unknown> };
			const factory = new Function(
				'exports',
				'module',
				'__filename',
				'__dirname',
				`${transformedSource}
				return module.exports;`
			);
			factory(
				exports,
				module,
				program.executablePath,
				this.getDirname(program.executablePath)
			);
			const entry =
				(module.exports?.default ?? exports.default) as
					| ((controller: typeof processController) => unknown)
					| undefined;
			if (typeof entry !== 'function') {
				throw new Error('Program missing default export for spawnSync');
			}
			const result = entry(processController as any);
			if (result && typeof (result as Promise<unknown>).then === 'function') {
				throw new Error(
					'SpawnSync programs must complete synchronously in this environment'
				);
			}
			if (!exited) {
				exitStatus = 0;
			}
		} catch (error) {
			return {
				status: null,
				error:
					error instanceof Error
						? error.message
						: String(error ?? 'spawnSync failed'),
			};
		}

		return {
			status: exitStatus,
			stdout:
				stdio.stdout === 'pipe' && stdoutChunks.length > 0
					? stdoutChunks.join('')
					: undefined,
			stderr:
				stdio.stderr === 'pipe' && stderrChunks.length > 0
					? stderrChunks.join('')
					: undefined,
		};
	}

	dispose() {
		try {
			this.hostSpawnSyncCleanup?.();
		} catch {
			// ignore cleanup errors
		}
		try {
			this.hostSpawnSyncClient?.dispose();
		} catch {
			// ignore disposal errors
		}
	}

	getProcess(pid: number) {
		const entry = this.processes.get(pid);
		return entry && entry.worker
			? (entry.worker as KernelSubprocess)
			: null;
	}

	listProcesses() {
		return Array.from(this.processes.values())
			.filter((record) => record.worker)
			.map((record) => record.worker as KernelSubprocess);
	}

	kill(pid: number) {
		const record = this.processes.get(pid);
		if (!record || record.exitCode !== null) {
			return false;
		}

		if (record.hostType === 'kernel') {
			record.worker?.terminate();
			this.handleProcessExit(pid, ExitCode.ERROR);
			return true;
		}

		const hostRecord =
			record.hostPid !== null ? this.processes.get(record.hostPid) : null;
		if (!hostRecord) {
			return false;
		}

		try {
			hostRecord.controlPort.postMessage({
				type: CONTROL_MESSAGE_HOST_KILL_CHILD,
				pid,
			});
		} catch {
			return false;
		}
		return true;
	}

	private prepareSpawnResources(
		options: SpawnOptions,
		program: { executablePath: string; programSource: string },
		parentPid: number | null
	): PreparedSpawnResources {
		const pid = this.pidCounter++;
		const stdioModes: [StdioMode, StdioMode, StdioMode] = [
			options.stdio?.stdin ?? 'pipe', // Default stdin to 'pipe' for IPC
			options.stdio?.stdout ?? 'inherit',
			options.stdio?.stderr ?? 'inherit',
		];

		const stdio: PreparedStdioResource[] = [];

		stdioModes.forEach((mode, fdIndex) => {
			const fd = fdIndex as 0 | 1 | 2;
			if (mode === 'ignore') {
				stdio.push({ fd, mode });
				return;
			}

			const channel = new MessageChannel();

			stdio.push({
				fd,
				mode,
				workerPort: channel.port1,
				hostPort: channel.port2,
			});
		});

		const controlChannel = new MessageChannel();
		const fsChannel = new MessageChannel();
		const spawnSyncChannel = new MessageChannel();
		let parentMessagePort: MessagePort | null = null;
		let workerMessagePort: MessagePort | null = null;

		if (options.ipcPort) {
			workerMessagePort = options.ipcPort;
		} else {
			const messageChannel = new MessageChannel();
			parentMessagePort = messageChannel.port1;
			workerMessagePort = messageChannel.port2;
		}

		return {
			pid,
			programPath: program.executablePath,
			programSource: program.programSource,
			stdio,
			control: {
				kernelPort: controlChannel.port1,
				processPort: controlChannel.port2,
			},
			fs: {
				kernelPort: fsChannel.port1,
				processPort: fsChannel.port2,
			},
			spawnSync: {
				kernelPort: spawnSyncChannel.port1,
				processPort: spawnSyncChannel.port2,
			},
			message: workerMessagePort
				? {
						parentPort: options.ipcPort ? null : parentMessagePort,
						workerPort: workerMessagePort,
				  }
				: undefined,
		};
	}

	private createKernelHostedProcess(
		options: SpawnOptions,
		program: { executablePath: string; programSource: string },
		resources: PreparedSpawnResources
	): KernelSubprocess {
		let parentStdin: MessagePortWritableStream | undefined;
		let parentStdout: MessagePortReadableStream | undefined;
		let parentStderr: MessagePortReadableStream | undefined;
		const stdioModesArray = (resources.stdioModes ?? [
			'inherit',
			'inherit',
			'inherit',
		]) as [StdioMode, StdioMode, StdioMode];
		const stdinLogPrefix =
			options.name && options.name.length > 0
				? `${options.name}:${resources.pid}`
				: `pid ${resources.pid}`;

		const transferList: MessagePort[] = [
			resources.control.processPort,
			resources.fs.processPort,
			resources.spawnSync.processPort,
		];

		for (const descriptor of resources.stdio) {
			if (descriptor.workerPort) {
				transferList.push(descriptor.workerPort);
			}
			if (descriptor.mode === 'pipe' && descriptor.hostPort) {
				if (descriptor.fd === 0) {
					parentStdin = new MessagePortWritableStream(
						descriptor.hostPort,
						{ debugLabel: `stdin -> ${stdinLogPrefix}` }
					);
					const originalWrite = parentStdin.write.bind(parentStdin);
					parentStdin.write = (chunk: KernelStdioChunk) => {
						this.enqueueProcessStdin(resources.pid, chunk);
						return originalWrite(chunk);
					};
					const originalEnd = parentStdin.end.bind(parentStdin);
					parentStdin.end = (chunk?: KernelStdioChunk) => {
						if (typeof chunk !== 'undefined') {
							this.enqueueProcessStdin(resources.pid, chunk);
						}
						this.closeProcessStdin(resources.pid);
						return originalEnd(chunk);
					};
					const originalDestroy = parentStdin.destroy.bind(parentStdin);
					parentStdin.destroy = () => {
						this.closeProcessStdin(resources.pid);
						originalDestroy();
					};
				} else if (descriptor.fd === 1) {
					parentStdout = new MessagePortReadableStream(
						descriptor.hostPort,
						{ debugLabel: 'kernel:parent-stdout' }
					);
				} else {
					parentStderr = new MessagePortReadableStream(
						descriptor.hostPort,
						{ debugLabel: 'kernel:parent-stderr' }
					);
				}
			} else if (descriptor.mode === 'inherit' && descriptor.hostPort) {
				this.attachInheritedStream(
					descriptor.fd,
					descriptor.hostPort,
					options.name,
					resources.pid
				);
			}
		}

		if (resources.message?.workerPort) {
			transferList.push(resources.message.workerPort);
		}

		const worker = createProcessWorker();
		worker.addEventListener('error', (error) => {
			console.error('[kernel] Worker error for pid', resources.pid);
			console.error('  Error object:', error);
			if (error instanceof ErrorEvent) {
				console.error('  message:', error.message);
				console.error('  filename:', error.filename);
				console.error('  lineno:', error.lineno);
				console.error('  colno:', error.colno);
				console.error('  error:', error.error);
			}
		});
		worker.addEventListener('messageerror', (error) => {
			console.error('[kernel] Worker message error for pid', resources.pid, ':', error);
		});

		const threadId = options.workerThreadId ?? resources.pid;
		const threadName =
			options.workerThreadName ??
			options.name ??
			`worker-${resources.pid}`;

		let exitCode: number | null = null;
		const exitListeners = new Set<ExitListener>();

		// Use Object.defineProperties to preserve the getter for exitCode
		Object.assign(worker, {
			pid: resources.pid,
			stdin: parentStdin,
			stdout: parentStdout,
			stderr: parentStderr,
			messagePort: resources.message?.parentPort ?? null,
			threadId,
			threadName,
			onExit: (listener: ExitListener) => {
				if (exitCode !== null) {
					try {
						listener(exitCode);
					} catch {
						// Ignore listener failures for already exited processes.
					}
					return;
				}
				exitListeners.add(listener);
			},
			offExit: (listener: ExitListener) => {
				exitListeners.delete(listener);
			},
			kill: () => {
				this.kill(resources.pid);
			},
		});

		Object.defineProperty(worker, 'exitCode', {
			get() {
				return exitCode;
			},
			enumerable: true,
			configurable: true,
		});

		const subprocess = worker as KernelSubprocess;

		const record: KernelProcessRecord = {
			pid: resources.pid,
			parentPid: null,
			name: options.name,
			controlPort: resources.control.kernelPort,
			fsPort: resources.fs.kernelPort,
			spawnSyncPort: resources.spawnSync.kernelPort,
			messagePort: resources.message?.parentPort ?? null,
			threadId,
			threadName,
			children: new Set<number>(),
			hostType: 'kernel',
			hostPid: null,
			worker,
			exitCode: null,
			exitListeners,
			stdio: {
				stdin: parentStdin,
				stdout: parentStdout,
				stderr: parentStderr,
			},
			stdioModes: {
				stdin: stdioModesArray[0],
				stdout: stdioModesArray[1],
				stderr: stdioModesArray[2],
			},
			logPrefix: stdinLogPrefix,
			controlCleanup: () => undefined,
			fsCleanup: () => undefined,
			spawnSyncCleanup: () => undefined,
			setExitCode: (code: number) => {
				if (exitCode !== null) {
					return;
				}
				exitCode = code;
				try {
					parentStdin?.destroy();
				} catch {
					// Ignore stream cleanup errors.
				}
			for (const listener of Array.from(exitListeners)) {
				try {
					listener(code);
				} catch {
					// Ignore listener failures.
				}
			}
			exitListeners.clear();
			this.closeProcessStdin(resources.pid);
			this.stdinStates.delete(resources.pid);
		},
	};

		this.processes.set(resources.pid, record);
		record.controlCleanup = this.installProcessControl(record);
		record.fsCleanup = this.installProcessFs(record);
		record.spawnSyncCleanup = this.installProcessSpawnSync(record);

		const initMessage = {
			type: '__kernel_internal__/initChildProcess',
			payload: {
				pid: resources.pid,
				argv: [...options.argv],
				env: { ...options.env },
				cwd: options.cwd,
				debug: Boolean(options.debug),
				stdio: resources.stdio.map((descriptor) => ({
					fd: descriptor.fd,
					mode: descriptor.mode,
					port: descriptor.workerPort,
				})),
				programPath: resources.programPath,
				programSource: resources.programSource,
				controlPort: resources.control.processPort,
				fsPort: resources.fs.processPort,
				spawnSyncPort: resources.spawnSync.processPort,
				messagePort: resources.message?.workerPort ?? null,
				threadId,
				threadName,
			},
		};

		console.log('[kernel] About to post init message to worker, pid:', resources.pid, 'argv:', options.argv);
		worker.postMessage(initMessage, transferList);
		console.log('[kernel] Posted init message to worker');

		return subprocess;
	}

	private ensureStdinState(pid: number): KernelStdinState {
		let state = this.stdinStates.get(pid);
		if (!state) {
			const waitSupported =
				typeof Atomics === 'object' &&
				typeof Atomics.wait === 'function' &&
				typeof SharedArrayBuffer === 'function';
			const waitBuffer = waitSupported ? new SharedArrayBuffer(4) : null;
			state = {
				buffer: new Uint8Array(0),
				closed: false,
				waitBuffer,
				waitView: waitBuffer ? new Int32Array(waitBuffer) : null,
			};
			this.stdinStates.set(pid, state);
		}
		return state;
	}

	private enqueueProcessStdin(pid: number, chunk: KernelStdioChunk) {
		if (chunk === null || typeof chunk === 'undefined') {
			return;
		}
		const state = this.ensureStdinState(pid);
		let bytes: Uint8Array;
		if (typeof chunk === 'string') {
			bytes = this.textEncoder.encode(chunk);
		} else {
			bytes = chunk.slice();
		}
		if (bytes.byteLength === 0) {
			return;
		}
		if (state.buffer.byteLength === 0) {
			state.buffer = bytes;
		} else {
			const merged = new Uint8Array(
				state.buffer.byteLength + bytes.byteLength
			);
			merged.set(state.buffer, 0);
			merged.set(bytes, state.buffer.byteLength);
			state.buffer = merged;
		}
		this.notifyStdinWaiters(state);
	}

	private closeProcessStdin(pid: number) {
		const state = this.ensureStdinState(pid);
		state.closed = true;
		this.notifyStdinWaiters(state);
	}

	private notifyStdinWaiters(state: KernelStdinState) {
		if (!state.waitView) {
			return;
		}
		try {
			Atomics.store(state.waitView, 0, 1);
			Atomics.notify(state.waitView, 0);
		} catch {
			state.waitView = null;
			state.waitBuffer = null;
		}
	}

	private readFromActiveProcessStdin(
		requestedLength: number
	): Uint8Array | null {
		const record = this.activeFsProcessRecord;
		if (!record) {
			return null;
		}
		const state = this.ensureStdinState(record.pid);
		if (state.buffer.byteLength === 0 && !state.closed && state.waitView) {
			const deadline = Date.now() + this.stdinWaitTimeoutMs;
			while (
				state.buffer.byteLength === 0 &&
				!state.closed &&
				Date.now() < deadline
			) {
				try {
					Atomics.store(state.waitView, 0, 0);
					const remaining = deadline - Date.now();
					if (remaining <= 0) {
						break;
					}
					Atomics.wait(state.waitView, 0, 0, remaining);
				} catch {
					state.waitView = null;
					state.waitBuffer = null;
					break;
				}
			}
		}
		const available = state.buffer.byteLength;
		if (available === 0) {
			return new Uint8Array(0);
		}
		if (requestedLength <= 0 || requestedLength >= available) {
			const result = state.buffer;
			state.buffer = new Uint8Array(0);
			return result;
		}
		const head = state.buffer.slice(0, requestedLength);
		state.buffer = state.buffer.slice(requestedLength);
		return head;
	}

	// Exposed for the InMemoryFileSystem fallback via duck typing.
	public __kernelReadProcessStdin(length: number): Uint8Array | null {
		return this.readFromActiveProcessStdin(length);
	}

	private installProcessFs(record: KernelProcessRecord) {
		const handleFsMessage = async (event: MessageEvent) => {
			const payload = event.data;
			if (!payload || typeof payload !== 'object') {
				return;
			}
			if (payload.type !== CONTROL_MESSAGE_FS_REQUEST) {
				return;
			}
			const requestId = payload.requestId;
			const method = payload.method;
			const args = payload.args;
			if (
				typeof requestId !== 'number' ||
				typeof method !== 'string' ||
				!Array.isArray(args)
			) {
				return;
			}

			console.error(`[kernel] Received FS request #${requestId} for PID ${record.pid}: ${method}(${JSON.stringify(args).slice(0, 100)})`);

			// Queue this filesystem operation on the GLOBAL queue to ensure
			// sequential execution across ALL processes, not just this one
			// This prevents race conditions when multiple processes access the same files
			this.fsQueue = this.fsQueue
				.then(async () => {
					console.error(`[kernel] Processing FS request #${requestId}: ${method}`);
					const previousActive = this.activeFsProcessRecord;
					this.activeFsProcessRecord = record;
					let response;
					try {
						const result = await this.invokeFsMethod(method, args);
						response = serializeFsResponse(result);
						console.error(`[kernel] FS request #${requestId} succeeded`);
					} catch (error) {
						response = serializeFsError(error);
						console.error(`[kernel] FS request #${requestId} failed:`, error);
					} finally {
						this.activeFsProcessRecord = previousActive;
					}
					try {
						record.fsPort.postMessage({
							type: CONTROL_MESSAGE_FS_RESPONSE,
							requestId,
							response,
						});
						console.error(`[kernel] Sent FS response #${requestId} to PID ${record.pid}`);
					} catch (e) {
						console.error(`[kernel] Failed to send FS response #${requestId}:`, e);
						// Ignore failures sending responses on a closed port.
					}
				})
				.catch((err) => {
					console.error(`[kernel] FS queue error for request #${requestId}:`, err);
					// Catch any errors to prevent breaking the queue chain
				});
		};

		console.error(`[kernel] Installing FS handler for PID ${record.pid}`);
		record.fsPort.addEventListener('message', handleFsMessage);
		record.fsPort.start();

		return () => {
			record.fsPort.removeEventListener('message', handleFsMessage);
			try {
				record.fsPort.close();
			} catch {
				// Ignore failures closing an already closed port.
			}
		};
	}

	private installProcessSpawnSync(record: KernelProcessRecord) {
		const handleSpawnSyncMessage = (event: MessageEvent) => {
			const payload = event.data;
			if (!payload || typeof payload !== 'object') {
				return;
			}
			if (payload.type !== CONTROL_MESSAGE_SPAWN_SYNC_REQUEST) {
				return;
			}
			const requestId = payload.requestId;
			const options = payload.options;
			if (typeof requestId !== 'number') {
				return;
			}
			this.handleSpawnSyncRequest(record, requestId, options);
		};

		record.spawnSyncPort.addEventListener(
			'message',
			handleSpawnSyncMessage
		);
		record.spawnSyncPort.start();

		return () => {
			record.spawnSyncPort.removeEventListener(
				'message',
				handleSpawnSyncMessage
			);
			try {
				record.spawnSyncPort.close();
			} catch {
				// ignore
			}
		};
	}

	private async invokeFsMethod(
		method: string,
		args: unknown[]
	): Promise<unknown> {
		const fsInstance = this as unknown as Record<string, unknown>;
		const target = fsInstance[method];
		if (typeof target !== 'function') {
			throw new Error(`Unsupported filesystem method '${method}'`);
		}
		const result = (target as (...args: unknown[]) => unknown).apply(
			this,
			args
		);
		if (result instanceof Promise) {
			return await result;
		}
		return result;
	}

	private handleSpawnSyncRequest(
		parentRecord: KernelProcessRecord,
		requestId: number,
		rawOptions: unknown
	) {
		console.error('[kernel:handleSpawnSyncRequest] RECEIVED! requestId:', requestId);
		const sendResponse = (response: {
			ok: boolean;
			result?: {
				status: number | null;
				stdout?: string;
				stderr?: string;
				error?: string;
			};
			error?: { message: string };
		}) => {
			try {
				parentRecord.spawnSyncPort.postMessage({
					type: CONTROL_MESSAGE_SPAWN_SYNC_RESPONSE,
					requestId,
					response,
				});
			} catch {
				// ignore
			}
		};

		const stdinInput = this.normalizeSpawnSyncInput(
			(rawOptions as { input?: unknown })?.input
		);
		const options = normalizeSpawnOptions(rawOptions);
		if (!options) {
			sendResponse({
				ok: false,
				error: { message: 'Invalid spawn options' },
			});
			return;
		}

		const timeoutMs =
			typeof options.timeout === 'number' &&
			Number.isFinite(options.timeout) &&
			options.timeout >= 0
				? options.timeout
				: 5000;

		this.runSpawnSyncProcess(parentRecord, options, timeoutMs, stdinInput)
			.then((result) => {
				sendResponse({ ok: true, result });
			})
			.catch((error) => {
				const message =
					error instanceof Error
						? error.message
						: String(error ?? 'spawnSync failed');
				sendResponse({ ok: false, error: { message } });
			});
	}

	private async runSpawnSyncProcess(
		parentRecord: KernelProcessRecord,
		options: NormalizedSpawnOptions,
		timeoutMs: number,
		stdinInput?: KernelStdioChunk
	): Promise<{
		status: number | null;
		stdout?: string;
		stderr?: string;
		error?: string;
	}> {
		console.error('[kernel:runSpawnSyncProcess] CALLED! argv:', options.argv[0], 'stdio:', JSON.stringify(options.stdio || {}));
		console.log('spawn sync', options);
		const program = this.loadProgram(options.argv[0], options.cwd);
		if (!program) {
			throw new Error(`Command not found: ${options.argv[0]}`);
		}

		const stdio: SpawnStdioOptions = {
			stdin: options.stdio?.stdin ?? 'pipe', // Default to 'pipe' for IPC like async spawn
			stdout: options.stdio?.stdout ?? 'pipe',
			stderr: options.stdio?.stderr ?? 'pipe',
		};

		const adjustedOptions: NormalizedSpawnOptions = {
			...options,
			stdio,
		};

		const resources = this.prepareSpawnResources(
			adjustedOptions,
			program,
			parentRecord.pid
		);

		const record: KernelProcessRecord = {
			pid: resources.pid,
			parentPid: parentRecord.pid,
			name: adjustedOptions.name,
			controlPort: resources.control.kernelPort,
			fsPort: resources.fs.kernelPort,
			spawnSyncPort: resources.spawnSync.kernelPort,
			children: new Set<number>(),
			hostType: 'process',
			hostPid: parentRecord.pid,
			exitCode: null,
			controlCleanup: () => undefined,
			fsCleanup: () => undefined,
			spawnSyncCleanup: () => undefined,
			stdio: undefined,
		};

		this.processes.set(resources.pid, record);
		parentRecord.children.add(resources.pid);
		record.controlCleanup = this.installProcessControl(record);
		record.fsCleanup = this.installProcessFs(record);
		record.spawnSyncCleanup = this.installProcessSpawnSync(record);

		const transferList: MessagePort[] = [
			resources.control.processPort,
			resources.fs.processPort,
			resources.spawnSync.processPort,
		];

		const textDecoder = new TextDecoder();
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		let stdinStream: MessagePortWritableStream | null = null;

		let stdoutStream: MessagePortReadableStream | null = null;
		let stderrStream: MessagePortReadableStream | null = null;

		for (const descriptor of resources.stdio) {
			if (descriptor.workerPort) {
				transferList.push(descriptor.workerPort);
			}
			if (descriptor.mode === 'pipe' && descriptor.hostPort) {
				if (descriptor.fd === 0) {
					stdinStream = new MessagePortWritableStream(
						descriptor.hostPort,
						{ debugLabel: 'kernel:child-stdin' }
					);
				} else if (descriptor.fd === 1) {
					const stream = new MessagePortReadableStream(
						descriptor.hostPort,
						{ debugLabel: 'kernel:child-stdout' }
					);
					stream.on('data', (chunk) => {
						const text =
							typeof chunk === 'string'
								? chunk
								: textDecoder.decode(chunk);
						stdoutChunks.push(text);
					});
					stdoutStream = stream;
				} else if (descriptor.fd === 2) {
					const stream = new MessagePortReadableStream(
						descriptor.hostPort,
						{ debugLabel: 'kernel:child-stderr' }
					);
					stream.on('data', (chunk) => {
						const text =
							typeof chunk === 'string'
								? chunk
								: textDecoder.decode(chunk);
						stderrChunks.push(text);
					});
					stderrStream = stream;
				} else {
					descriptor.hostPort.close();
				}
			} else if (descriptor.hostPort) {
				descriptor.hostPort.close();
			}
		}

		const worker = createProcessWorker();
		record.worker = worker;

		record.setExitCode = (code: number) => {
			finalize(code);
		};

		let resultResolve: (value: {
			status: number | null;
			stdout?: string;
			stderr?: string;
			error?: string;
		}) => void;
		const resultPromise = new Promise<{
			status: number | null;
			stdout?: string;
			stderr?: string;
			error?: string;
		}>((resolve) => {
			resultResolve = resolve;
		});

		let resolved = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

		const finalize = (status: number | null, error?: string): void => {
			if (resolved) {
				return;
			}
			resolved = true;
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
				timeoutHandle = null;
			}
			stdinStream?.destroy();
			stdoutStream?.destroy();
			stderrStream?.destroy();
			resultResolve({
				status,
				stdout:
					stdoutChunks.length > 0 ? stdoutChunks.join('') : undefined,
				stderr:
					stderrChunks.length > 0 ? stderrChunks.join('') : undefined,
				error,
			});
		};

		worker.addEventListener('message', (event: MessageEvent) => {
			const payload = event.data;
			if (
				payload &&
				typeof payload === 'object' &&
				payload.type === 'exit'
			) {
				const code =
					typeof payload.data === 'number' ? payload.data : null;
				finalize(code);
			}
		});

		worker.addEventListener('error', (event) => {
			console.error('[kernel] Worker error event:', event);
			console.error('[kernel] Worker error message:', event.message);
			console.error('[kernel] Worker error filename:', event.filename);
			console.error('[kernel] Worker error lineno:', event.lineno);
			console.error('[kernel] Worker error colno:', event.colno);
			console.error('[kernel] Worker error error:', event.error);
			finalize(null, 'Process worker crashed');
			this.handleProcessExit(resources.pid, ExitCode.ERROR);
		});

		const initMessage = {
			type: '__kernel_internal__/initChildProcess',
			payload: {
				pid: resources.pid,
				argv: [...adjustedOptions.argv],
				env: { ...adjustedOptions.env },
				cwd: adjustedOptions.cwd,
				debug: Boolean(adjustedOptions.debug),
				stdio: resources.stdio.map((descriptor) => ({
					fd: descriptor.fd,
					mode: descriptor.mode,
					port: descriptor.workerPort,
				})),
				programPath: resources.programPath,
				programSource: resources.programSource,
				controlPort: resources.control.processPort,
				fsPort: resources.fs.processPort,
				spawnSyncPort: resources.spawnSync.processPort,
			},
		};

		try {
			worker.postMessage(initMessage, transferList);
		} catch (error) {
			finalize(
				null,
				error instanceof Error
					? error.message
					: String(error ?? 'Failed to initialize process')
			);
			this.handleProcessExit(resources.pid, ExitCode.ERROR);
			return resultPromise;
		}

		if (stdinStream) {
			try {
				if (typeof stdinInput !== 'undefined') {
					const chunk =
						typeof stdinInput === 'string'
							? stdinInput
							: stdinInput.slice();
					stdinStream.write(chunk);
				}
			} finally {
				stdinStream.end();
			}
		}

		timeoutHandle = setTimeout(() => {
			finalize(null, `Process timed out after ${timeoutMs}ms`);
			try {
				worker.terminate();
			} catch {
				// ignore
			}
			this.handleProcessExit(resources.pid, ExitCode.ERROR);
		}, timeoutMs);

		return resultPromise;
	}

	private installProcessControl(record: KernelProcessRecord) {
		const handleControlMessage = (event: MessageEvent) => {
			const payload = event.data;
			if (!payload || typeof payload !== 'object') {
				return;
			}

		if (payload.type === CONTROL_MESSAGE_SPAWN_REQUEST) {
			this.handleSpawnRequestFromProcess(
				record,
				payload.requestId,
				payload.options
			);
		} else if (payload.type === CONTROL_MESSAGE_STDIN_DATA) {
			const pid = typeof payload.pid === 'number' ? payload.pid : null;
			if (pid && this.processes.has(pid)) {
				const targetRecord = this.processes.get(pid)!;
				const chunk = payload.chunk as KernelStdioChunk | undefined;

				// For nested spawns with relay port, forward data directly to child's stdin
				if (targetRecord.stdinRelayPort) {
					console.error('[kernel] Relaying stdin data to pid:', pid, 'chunk size:', chunk ? (typeof chunk === 'string' ? chunk.length : chunk.byteLength) : 0);
					if (chunk !== undefined && chunk !== null) {
						try {
							targetRecord.stdinRelayPort.postMessage({ type: 'data', payload: chunk });
						} catch (error) {
							console.error('[kernel] Failed to relay stdin:', error);
						}
					}
					if (payload.end) {
						try {
							targetRecord.stdinRelayPort.postMessage({ type: 'end' });
							targetRecord.stdinRelayPort.close();
							targetRecord.stdinRelayPort = null;
						} catch (error) {
							console.error('[kernel] Failed to close relay port:', error);
						}
					}
				} else {
					// For direct spawns, use the existing enqueue mechanism
					if (chunk !== undefined && chunk !== null) {
						this.enqueueProcessStdin(pid, chunk);
					}
					if (payload.end) {
						this.closeProcessStdin(pid);
					}
				}
			}
		} else if (payload.type === CONTROL_MESSAGE_KILL_REQUEST) {
				const targetPid = payload.pid;
				const requestId = payload.requestId;
				const success =
					typeof targetPid === 'number'
						? this.kill(targetPid)
						: false;
				try {
					record.controlPort.postMessage({
						type: CONTROL_MESSAGE_KILL_RESULT,
						requestId,
						success,
					});
				} catch {
					// Ignore postMessage failures if the port is closed.
				}
			} else if (
				payload.type === CONTROL_MESSAGE_PROCESS_EXIT &&
				typeof payload.pid === 'number'
			) {
				this.handleProcessExit(
					payload.pid,
					typeof payload.code === 'number'
						? payload.code
						: ExitCode.ERROR
				);
			} else if (
				payload.type === CONTROL_MESSAGE_REPORT_CHILD_EXIT &&
				typeof payload.pid === 'number'
			) {
				this.handleProcessExit(
					payload.pid,
					typeof payload.code === 'number'
						? payload.code
						: ExitCode.ERROR
				);
			}
		};

		record.controlPort.addEventListener('message', handleControlMessage);
		record.controlPort.start();

		return () => {
			record.controlPort.removeEventListener(
				'message',
				handleControlMessage
			);
			try {
				record.controlPort.close();
			} catch {
				// Ignore failures closing an already closed port.
			}
		};
	}

	private spawnRequestCounter = 0;
	private handleSpawnRequestFromProcess(
		parentRecord: KernelProcessRecord,
		requestId: unknown,
		rawOptions: unknown
	) {
		if (typeof requestId !== 'number') {
			return;
		}

		const options = normalizeSpawnOptions(rawOptions);
		if (!options) {
			this.sendSpawnFailure(parentRecord.controlPort, requestId);
			return;
		}

		// Log stdio options for spawn requests
		this.spawnRequestCounter++;
		console.error('[kernel:handleSpawnRequest #' + this.spawnRequestCounter + '] FULL argv:', JSON.stringify(options.argv), 'stdio:', JSON.stringify(options.stdio || 'undefined'));

		const program = this.loadProgram(options.argv[0], options.cwd);
		if (!program) {
			this.sendSpawnFailure(
				parentRecord.controlPort,
				requestId,
				ExitCode.NOT_FOUND
			);
			return;
		}

		const resources = this.prepareSpawnResources(
			options,
			program,
			parentRecord.pid
		);

		// Track stdin ports for relaying data from parent to child
		let stdinHostPort: MessagePort | null = null;
		let stdinRelayChannel: MessageChannel | null = null;

		const record: KernelProcessRecord = {
			pid: resources.pid,
			parentPid: parentRecord.pid,
			name: options.name,
			controlPort: resources.control.kernelPort,
			fsPort: resources.fs.kernelPort,
			spawnSyncPort: resources.spawnSync.kernelPort,
			messagePort: null,
			threadId: options.workerThreadId,
			threadName: options.workerThreadName,
			children: new Set<number>(),
			hostType: 'process',
			hostPid: parentRecord.pid,
			exitCode: null,
			stdinRelayPort: stdinHostPort,  // Store for relaying stdin data
			controlCleanup: () => undefined,
			fsCleanup: () => undefined,
			spawnSyncCleanup: () => undefined,
		};

		this.processes.set(resources.pid, record);
		parentRecord.children.add(resources.pid);
		record.controlCleanup = this.installProcessControl(record);
		record.fsCleanup = this.installProcessFs(record);
		record.spawnSyncCleanup = this.installProcessSpawnSync(record);

		// Process stdio descriptors FIRST to create relay channel before building response
		const transferList: MessagePort[] = [
			resources.control.processPort,
			resources.fs.processPort,
			resources.spawnSync.processPort,
		];

		for (const descriptor of resources.stdio) {
			if (descriptor.workerPort) {
				transferList.push(descriptor.workerPort);
			}
			// For pipe mode, handle stdin specially with relay channel
			// Transferring both ports in same postMessage breaks their connection
			if (descriptor.mode === 'pipe' && descriptor.hostPort) {
				if (descriptor.fd === 0) {
					// For stdin: create relay channel
					// - port1 goes to parent (runner writes to it)
					// - port2 stays in kernel (listens and relays to binary's stdin)
					stdinRelayChannel = new MessageChannel();
					stdinHostPort = descriptor.hostPort;
					stdinHostPort.start();

					// Set up relay from parent -> binary
					const relayPort = stdinRelayChannel.port2;
					relayPort.start();

					relayPort.addEventListener('message', (event) => {
						const data = event.data;
						if (data && data.type === 'data') {
							try {
								stdinHostPort!.postMessage({ type: 'data', payload: data.payload });
							} catch (error) {
								console.error('[kernel] Failed to relay stdin data:', error);
							}
						} else if (data && data.type === 'end') {
							try {
								stdinHostPort!.postMessage({ type: 'end' });
								stdinHostPort!.close();
								relayPort.close();
							} catch (error) {
								console.error('[kernel] Failed to relay stdin end:', error);
							}
						}
					});

					// Transfer port1 to parent
					transferList.push(stdinRelayChannel.port1);
				} else {
					// For stdout/stderr in pipe mode, transfer to parent so they can read
					transferList.push(descriptor.hostPort);
				}
			} else if (descriptor.mode === 'inherit' && descriptor.hostPort) {
				// Child output should still reach the kernel console.
				this.attachInheritedStream(
					descriptor.fd,
					descriptor.hostPort,
					options.name,
					resources.pid
				);
			}
		}
		if (resources.message?.workerPort) {
			transferList.push(resources.message.workerPort);
		}
		if (resources.message?.parentPort) {
			transferList.push(resources.message.parentPort);
		}

		const response = {
			type: CONTROL_MESSAGE_SPAWN_RESULT,
			requestId,
			result: {
				pid: resources.pid,
				programPath: resources.programPath,
				programSource: resources.programSource,
				threadId: options.workerThreadId ?? resources.pid,
				threadName:
					options.workerThreadName ??
					options.name ??
					`worker-${resources.pid}`,
				stdio: resources.stdio.map((descriptor) => ({
					fd: descriptor.fd,
					mode: descriptor.mode,
					workerPort: descriptor.workerPort ?? null,
					parentPort:
						descriptor.mode === 'pipe' && descriptor.fd === 0
							? stdinRelayChannel?.port1 ?? null  // For stdin, parent writes to relay channel
							: descriptor.mode === 'pipe' && descriptor.fd !== 0
							? descriptor.hostPort ?? null  // For stdout/stderr, parent reads from hostPort
							: null,
				})),
				controlPort: resources.control.processPort,
				fsPort: resources.fs.processPort,
				spawnSyncPort: resources.spawnSync.processPort,
				messagePort: resources.message
					? {
							workerPort: resources.message.workerPort ?? null,
							parentPort: resources.message.parentPort ?? null,
					  }
					: undefined,
			},
		};

		try {
			parentRecord.controlPort.postMessage(response, transferList);
		} catch {
			// If the parent can no longer receive messages, tear down the child.
			this.handleProcessExit(resources.pid, ExitCode.ERROR);
		}
	}

	private sendSpawnFailure(
		controlPort: MessagePort,
		requestId: number,
		code: ExitCode = ExitCode.ERROR
	) {
		try {
			controlPort.postMessage({
				type: CONTROL_MESSAGE_SPAWN_RESULT,
				requestId,
				error: { code },
			});
		} catch {
			// Ignore failures caused by a closed port.
		}
	}

	private handleProcessExit(pid: number, code: number) {
		const record = this.processes.get(pid);
		if (!record || record.exitCode !== null) {
			return;
		}

		record.exitCode = code;
		record.setExitCode?.(code);

		record.controlCleanup();
		record.fsCleanup();
		record.spawnSyncCleanup();

		try {
			record.messagePort?.close();
		} catch {
			// Ignore message port cleanup failures.
		}

		this.processes.delete(pid);

		if (record.parentPid !== null) {
			const parentRecord = this.processes.get(record.parentPid);
			parentRecord?.children.delete(pid);
			if (parentRecord) {
				try {
					parentRecord.controlPort.postMessage({
						type: CONTROL_MESSAGE_CHILD_EXIT,
						pid,
						code,
					});
				} catch {
					// Ignore failures dispatching child exit notifications.
				}
			}
		}

		const childPids = Array.from(record.children);
		for (const childPid of childPids) {
			this.kill(childPid);
		}

		if (record.hostType === 'kernel') {
			record.stdio?.stdin?.destroy();
			record.stdio?.stdout?.destroy();
			record.stdio?.stderr?.destroy();

			if (record.exitListeners) {
				for (const listener of Array.from(record.exitListeners)) {
					try {
						listener(code);
					} catch {
						// Ignore listener failures to avoid disrupting cleanup.
					}
				}
				record.exitListeners.clear();
			}
		}
	}

	private attachInheritedStream(
		fd: 0 | 1 | 2,
		port: MessagePort,
		processName: string,
		pid: number
	) {
		if (fd === 0) {
			try {
				port.postMessage({ type: 'end' });
			} catch {
				// Ignore failures notifying stdin closure.
			} finally {
				port.close();
			}
			return;
		}

		const logger = fd === 1 ? console.log : console.error;
		const prefix = processName ? `[${processName}:${pid}]` : `[pid ${pid}]`;

		const handleMessage = (event: MessageEvent) => {
			const payload = event.data;
			if (!payload || typeof payload !== 'object') {
				return;
			}
			if (payload.type === 'data') {
				const raw = payload.payload as KernelStdioChunk;
				const text =
					typeof raw === 'string'
						? raw
						: this.textDecoder.decode(raw);
				logger(`${prefix} ${text}`);
			} else if (payload.type === 'end' || payload.type === 'close') {
				port.removeEventListener('message', handleMessage);
				port.close();
			}
		};

		port.addEventListener('message', handleMessage);
		port.start();
	}
}

export const KernelClass = Kernel;
