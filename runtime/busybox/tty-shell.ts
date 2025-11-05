declare const processController: any;

const utilsModuleUrl = new URL('./lib/utils.ts', import.meta.url).href;
const pathsModuleUrl = new URL('../util/paths.ts', import.meta.url).href;
const runModuleUrl = new URL('../shell/run.ts', import.meta.url).href;
const parseModuleUrl = new URL('../shell/sh.ts', import.meta.url).href;

const createProgramSource = (): string => {
	const program = async function main(urls: {
		utilsModuleUrl: string;
		pathsModuleUrl: string;
		runModuleUrl: string;
		parseModuleUrl: string;
	}): Promise<void> {
		const [
			{ errorToString, exitSafely, getArgv, writeStderr, writeStdout },
			{ joinPaths, normalizePath },
			{ runShellScript },
			{ parseShellCode },
		] = await Promise.all([
			import(/* @vite-ignore */ urls.utilsModuleUrl),
			import(/* @vite-ignore */ urls.pathsModuleUrl),
			import(/* @vite-ignore */ urls.runModuleUrl),
			import(/* @vite-ignore */ urls.parseModuleUrl),
		]);

		type InputToken =
			| { kind: 'char'; value: string }
			| { kind: 'escape'; sequence: string };

		interface SearchSnapshot {
			buffer: string;
			cursor: number;
		}

		interface CompletionEntry {
			display: string;
			name: string;
			isDir: boolean;
		}

		interface CompletionResult {
			entries: CompletionEntry[];
			baseToken: string;
			directoryToken: string;
			resolvedDirectory: string;
			fromCommands: boolean;
		}

		const decoder = new TextDecoder();
		const fs = processController.fsSync;
		const argv = getArgv();
		const prompt = argv[0] ?? '$ ';

		let buffer = '';
		let cursor = 0;
		let historyIndex: number | null = null;
		const history: string[] = [];
		const maxHistory = 200;

		let pending = '';
		let ignoreNextLineFeed = false;

		let searchActive = false;
		let searchQuery = '';
		let searchMatches: number[] = [];
		let searchMatchPointer = 0;
		let searchSnapshot: SearchSnapshot | null = null;

		const render = () => {
			// Move to start of line, clear it
			let output = '\r\x1b[K';

			if (searchActive) {
				// Render search mode
				const hasMatch = searchMatchPointer < searchMatches.length;
				const match = hasMatch
					? history[searchMatches[searchMatchPointer]]
					: '';
				output += `(reverse-i-search)\`${searchQuery}': ${match}`;
			} else {
				// Normal mode: render prompt + buffer
				output += prompt + buffer;

				// Position cursor correctly
				const distance = buffer.length - cursor;
				if (distance > 0) {
					output += `\x1b[${distance}D`;
				}
			}

			processController.stdout?.write(output);
		};

		const clampCursor = (index: number) => {
			cursor = Math.max(0, Math.min(buffer.length, index));
		};

		const isWhitespace = (char: string) => /\s/.test(char);

		const resetHistoryNavigation = () => {
			historyIndex = null;
		};

		const insertText = (text: string) => {
			if (!text) return;
			resetHistoryNavigation();
			buffer = buffer.slice(0, cursor) + text + buffer.slice(cursor);
			clampCursor(cursor + text.length);
			render();
		};

		const deleteLeft = () => {
			if (cursor === 0) return;
			resetHistoryNavigation();
			buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
			clampCursor(cursor - 1);
			render();
		};

		const deleteRight = () => {
			if (cursor >= buffer.length) return;
			resetHistoryNavigation();
			buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1);
			render();
		};

		const deleteWordLeft = () => {
			if (cursor === 0) return;
			resetHistoryNavigation();
			let index = cursor;
			while (index > 0 && isWhitespace(buffer[index - 1])) {
				index -= 1;
			}
			while (index > 0 && !isWhitespace(buffer[index - 1])) {
				index -= 1;
			}
			buffer = buffer.slice(0, index) + buffer.slice(cursor);
			clampCursor(index);
			render();
		};

		const deleteToStart = () => {
			if (cursor === 0) return;
			resetHistoryNavigation();
			buffer = buffer.slice(cursor);
			clampCursor(0);
			render();
		};

		const deleteToEnd = () => {
			if (cursor >= buffer.length) return;
			resetHistoryNavigation();
			buffer = buffer.slice(0, cursor);
			render();
		};

		const setBuffer = (text: string) => {
			buffer = text;
			clampCursor(text.length);
			render();
		};

		const pushHistory = (entry: string) => {
			if (!entry) return;
			if (history.length && history[history.length - 1] === entry) {
				return;
			}
			history.push(entry);
			if (history.length > maxHistory) {
				history.shift();
			}
		};

		const leaveSearchMode = (applyMatch: boolean) => {
			if (!searchActive) {
				return;
			}
			let chosen: string | null = null;
			if (applyMatch && searchMatchPointer < searchMatches.length) {
				const index = searchMatches[searchMatchPointer];
				if (index >= 0 && index < history.length) {
					chosen = history[index];
				}
			}
			const snapshot = searchSnapshot;
			searchActive = false;
			searchQuery = '';
			searchMatches = [];
			searchMatchPointer = 0;
			searchSnapshot = null;

			if (chosen !== null) {
				buffer = chosen;
				clampCursor(buffer.length);
				render();
				return;
			}
			if (snapshot) {
				buffer = snapshot.buffer;
				clampCursor(snapshot.cursor);
				render();
			} else {
				render();
			}
		};

		const updateSearchMatches = () => {
			const matches: number[] = [];
			if (searchQuery) {
				for (let index = history.length - 1; index >= 0; index -= 1) {
					if (history[index].includes(searchQuery)) {
						matches.push(index);
					}
				}
			} else {
				for (let index = history.length - 1; index >= 0; index -= 1) {
					matches.push(index);
				}
			}
			searchMatches = matches;
			if (!matches.length) {
				searchMatchPointer = 0;
				return;
			}
			if (searchMatchPointer >= matches.length) {
				searchMatchPointer = 0;
			}
		};

		const emitSearch = () => {
			render();
		};

		const ensureSearchActive = () => {
			if (searchActive) {
				emitSearch();
				return;
			}
			if (!history.length) {
				return;
			}
			searchActive = true;
			searchQuery = '';
			searchMatchPointer = 0;
			searchSnapshot = { buffer, cursor };
			updateSearchMatches();
			emitSearch();
		};

		const nextSearchMatch = () => {
			if (!searchActive || !searchMatches.length) {
				return;
			}
			searchMatchPointer =
				(searchMatchPointer + 1) % searchMatches.length;
			emitSearch();
		};

		const previousSearchMatch = () => {
			if (!searchActive || !searchMatches.length) {
				return;
			}
			searchMatchPointer =
				(searchMatchPointer - 1 + searchMatches.length) %
				searchMatches.length;
			emitSearch();
		};

		const applySearchMatch = () => {
			if (!searchActive) {
				return;
			}
			leaveSearchMode(true);
		};

		const cancelSearch = () => {
			if (!searchActive) {
				return;
			}
			leaveSearchMode(false);
		};

		const getWordInfo = () => {
			const left = buffer.slice(0, cursor);
			const match = left.match(/(^|\s)([^\s]*)$/);
			const word = match ? match[2] : '';
			const start = match ? left.length - word.length : 0;
			return {
				start,
				prefix: word,
			};
		};

		const getCurrentDirectory = () =>
			typeof processController.cwd === 'function'
				? processController.cwd()
				: '/';

		const longestCommonPrefix = (values: string[]) => {
			if (!values.length) {
				return '';
			}
			let prefixValue = values[0];
			for (const value of values.slice(1)) {
				while (!value.startsWith(prefixValue) && prefixValue) {
					prefixValue = prefixValue.slice(0, -1);
				}
				if (!prefixValue) {
					break;
				}
			}
			return prefixValue;
		};

		const gatherCommandCompletions = (prefix: string) => {
			const results: CompletionEntry[] = [];
			const seen = new Set<string>();
			const getEnv =
				typeof processController.getEnv === 'function'
					? processController.getEnv.bind(processController)
					: null;
			const pathValue = getEnv ? getEnv('PATH') : '';
			const pathSegments = pathValue
				? pathValue.split(':').filter(Boolean)
				: ['/bin'];
			for (const segment of pathSegments) {
				try {
					const entries = fs.readdirSync(segment) as unknown[];
					for (const entry of entries) {
						const name = String(entry);
						if (!name.startsWith(prefix)) {
							continue;
						}
						if (seen.has(name)) {
							continue;
						}
						seen.add(name);
						results.push({
							display: name,
							name,
							isDir: false,
						});
					}
				} catch (error) {
					writeStderr(
						`tty-shell: completion error: ${errorToString(error)}`
					);
				}
			}
			results.sort((a, b) =>
				a.display < b.display ? -1 : a.display > b.display ? 1 : 0
			);
			return results;
		};

		const gatherPathCompletions = (
			prefix: string,
			isCommandPosition: boolean
		): CompletionResult => {
			const slashIndex = prefix.lastIndexOf('/');
			const directoryToken =
				slashIndex === -1 ? '' : prefix.slice(0, slashIndex + 1);
			const baseToken =
				slashIndex === -1 ? prefix : prefix.slice(slashIndex + 1);

			let resolvedDirectory: string;
			if (prefix.startsWith('/')) {
				resolvedDirectory = directoryToken
					? normalizePath(directoryToken)
					: '/';
			} else {
				resolvedDirectory = normalizePath(
					joinPaths(getCurrentDirectory(), directoryToken || '.')
				);
			}

			let entries: string[] = [];
			try {
				entries = (fs.readdirSync(resolvedDirectory) as unknown[]).map(
					(entry) => String(entry)
				);
			} catch {
				entries = [];
			}

			const matched = entries.filter((entry) =>
				entry.startsWith(baseToken)
			);

			const results: CompletionEntry[] = [];
			for (const entry of matched) {
				let isDir = false;
				try {
					const absolute = joinPaths(resolvedDirectory, entry);
					const stats = fs.statSync(absolute);
					if (
						stats &&
						typeof stats.isDirectory === 'function' &&
						stats.isDirectory()
					) {
						isDir = true;
					}
				} catch (error) {
					writeStderr(
						`tty-shell: stat error: ${errorToString(error)}`
					);
				}
				const decorated = `${directoryToken}${entry}${
					isDir ? '/' : ''
				}`;
				results.push({
					display: decorated,
					name: entry,
					isDir,
				});
			}

			if (!results.length && isCommandPosition) {
				return {
					entries: gatherCommandCompletions(baseToken),
					baseToken,
					directoryToken: '',
					resolvedDirectory: '',
					fromCommands: true,
				};
			}

			results.sort((a, b) =>
				a.display < b.display ? -1 : a.display > b.display ? 1 : 0
			);

			return {
				entries: results,
				baseToken,
				directoryToken,
				resolvedDirectory,
				fromCommands: false,
			};
		};

		const handleCompletions = (reverse = false) => {
			const { start, prefix } = getWordInfo();
			const beforeWord = buffer.slice(0, start);
			const isCommandPosition = beforeWord.trim().length === 0;

			const result = gatherPathCompletions(prefix, isCommandPosition);
			let entries = result.entries;
			if (!entries.length) {
				// Bell/beep for no matches
				writeStdout('\x07', { appendNewline: false });
				return;
			}

			if (reverse) {
				entries = [...entries].reverse();
			}

			const baseNames = result.entries.map((entry) => entry.name);
			const shared = longestCommonPrefix(baseNames);
			if (shared && shared.length > result.baseToken.length) {
				const addition = shared.slice(result.baseToken.length);
				insertText(addition);
			}

			if (result.entries.length === 1) {
				const only = result.entries[0];
				if (only.isDir) {
					const prior = buffer.slice(0, cursor);
					if (!prior.endsWith('/')) {
						insertText('/');
					}
				} else {
					insertText(' ');
				}
			} else if (
				result.entries.length > 1 &&
				shared === result.baseToken
			) {
				// Show matches if we can't complete further
				writeStdout('\r\n', { appendNewline: false });
				const displays = entries.map((entry) => entry.display);
				for (let i = 0; i < displays.length; i += 1) {
					writeStdout(displays[i], { appendNewline: false });
					if (i < displays.length - 1) {
						writeStdout('  ', { appendNewline: false });
					}
				}
				writeStdout('\r\n', { appendNewline: false });
				render();
			}
		};

		const moveCursorLeft = (steps = 1) => {
			if (steps <= 0) return;
			clampCursor(cursor - steps);
			render();
		};

		const moveCursorRight = (steps = 1) => {
			if (steps <= 0) return;
			clampCursor(cursor + steps);
			render();
		};

		const moveWordLeft = () => {
			if (cursor === 0) return;
			let index = cursor;
			while (index > 0 && isWhitespace(buffer[index - 1])) {
				index -= 1;
			}
			while (index > 0 && !isWhitespace(buffer[index - 1])) {
				index -= 1;
			}
			clampCursor(index);
			render();
		};

		const moveWordRight = () => {
			if (cursor >= buffer.length) return;
			let index = cursor;
			while (index < buffer.length && !isWhitespace(buffer[index])) {
				index += 1;
			}
			while (index < buffer.length && isWhitespace(buffer[index])) {
				index += 1;
			}
			clampCursor(index);
			render();
		};

		const forwardStream = (
			readable: {
				on?: (
					event: string,
					listener: (...args: any[]) => void
				) => void;
				once?: (
					event: string,
					listener: (...args: any[]) => void
				) => void;
				off?: (
					event: string,
					listener: (...args: any[]) => void
				) => void;
			} | null,
			writable: { write?: (chunk: unknown) => void } | null
		): Promise<void> => {
			if (!readable || typeof readable.on !== 'function') {
				return Promise.resolve();
			}
			if (!writable || typeof writable.write !== 'function') {
				return Promise.resolve();
			}
			return new Promise((resolve) => {
				if (typeof readable.on !== 'function') {
					resolve();
					return;
				}

				const handleData = (chunk: unknown) => {
					try {
						writable.write?.(chunk);
					} catch {
						// ignore write failures
					}
				};

				let settled = false;
				const cleanup = () => {
					readable.off?.('data', handleData as any);
					readable.off?.('end', handleEnd as any);
					readable.off?.('close', handleClose as any);
				};
				const finish = () => {
					if (settled) {
						return;
					}
					settled = true;
					cleanup();
					resolve();
				};
				const handleEnd = () => {
					finish();
				};
				const handleClose = () => {
					finish();
				};
				readable.on?.('data', handleData as any);
				readable.on?.('end', handleEnd as any);
				readable.on?.('close', handleClose as any);
			});
		};

		const runCommandFromLine = async (line: string) => {
			let ast: unknown;
			try {
				ast = parseShellCode(line);
			} catch (error) {
				writeStderr(`tty-shell: ${errorToString(error)}`);
				return;
			}

			const forwarders: Promise<void>[] = [];
			const shellController = {
				...processController,
				spawn: async (options: {
					argv: string[];
					env?: Record<string, string>;
					cwd?: string;
					name?: string;
					debug?: boolean;
					stdio?: {
						stdin?: string;
						stdout?: string;
						stderr?: string;
					};
					timeout?: number;
				}) => {
					const originalStdio = options.stdio ?? {};
					const stdio = { ...originalStdio };
					const parentStdout = processController.stdout ?? null;
					const parentStderr = processController.stderr ?? null;
					const shouldPipeStdout =
						!stdio.stdout && parentStdout !== null;
					const shouldPipeStderr =
						!stdio.stderr && parentStderr !== null;

					if (shouldPipeStdout) {
						stdio.stdout = 'pipe';
					}
					if (shouldPipeStderr) {
						stdio.stderr = 'pipe';
					}

					const child = await processController.spawn({
						...options,
						stdio:
							stdio.stdin || stdio.stdout || stdio.stderr
								? stdio
								: options.stdio,
					});

					if (shouldPipeStdout) {
						forwarders.push(
							forwardStream(child.stdout ?? null, parentStdout)
						);
					}
					if (shouldPipeStderr) {
						forwarders.push(
							forwardStream(child.stderr ?? null, parentStderr)
						);
					}

					return child;
				},
			};

			try {
				await runShellScript(shellController, ast);
				if (forwarders.length) {
					await Promise.allSettled(forwarders);
				}
			} catch (error) {
				writeStderr(`tty-shell: ${errorToString(error)}`);
			}
		};

		const handleSubmit = () => {
			const line = buffer;
			writeStdout('\r\n', { appendNewline: false });
			const trimmed = line.trim();
			if (trimmed) {
				pushHistory(line);
			}
			buffer = '';
			cursor = 0;
			ignoreNextLineFeed = false;
			resetHistoryNavigation();

			if (!trimmed) {
				render();
				return;
			}

			void (async () => {
				try {
					await runCommandFromLine(line);
				} finally {
					render();
				}
			})();
		};

		const handleInterrupt = () => {
			writeStdout('^C\r\n', { appendNewline: false });
			buffer = '';
			cursor = 0;
			ignoreNextLineFeed = false;
			resetHistoryNavigation();
			render();
		};

		const handleClear = () => {
			// Clear screen and move to top
			writeStdout('\x1b[2J\x1b[H', { appendNewline: false });
			render();
		};

		const handleExit = () => {
			writeStdout('\r\n', { appendNewline: false });
			exitSafely(0);
		};

		const navigateHistory = (direction: 1 | -1) => {
			if (!history.length) return;
			if (direction === -1) {
				if (historyIndex === null) {
					historyIndex = history.length - 1;
				} else if (historyIndex > 0) {
					historyIndex -= 1;
				}
			} else {
				if (historyIndex === null) {
					return;
				}
				if (historyIndex < history.length - 1) {
					historyIndex += 1;
				} else {
					historyIndex = null;
					buffer = '';
					cursor = 0;
					render();
					return;
				}
			}

			if (historyIndex !== null) {
				const entry = history[historyIndex];
				buffer = entry;
				clampCursor(buffer.length);
				render();
			}
		};

		const interpretEscape = (sequence: string) => {
			switch (sequence) {
				case '\u001b[A':
				case '\u001bOA':
					navigateHistory(-1);
					return;
				case '\u001b[B':
				case '\u001bOB':
					navigateHistory(1);
					return;
				case '\u001b[C':
				case '\u001bOC':
					moveCursorRight();
					return;
				case '\u001b[D':
				case '\u001bOD':
					moveCursorLeft();
					return;
				case '\u001b[H':
				case '\u001bOH':
				case '\u001b[1~':
					clampCursor(0);
					render();
					return;
				case '\u001b[F':
				case '\u001bOF':
				case '\u001b[4~':
					clampCursor(buffer.length);
					render();
					return;
				case '\u001b[3~':
					deleteRight();
					return;
				case '\u001b[Z':
					handleCompletions(true);
					return;
			}

			const controlMatch = sequence.match(
				/\u001b\[(\d+);(\d+)([A-Za-z])/
			);
			if (controlMatch) {
				const [, , modifier, final] = controlMatch;
				const modifierValue = Number(modifier);
				const hasModifier = Number.isFinite(modifierValue);
				const hasCtrl = hasModifier && ((modifierValue - 1) & 4) !== 0;
				const hasAlt = hasModifier
					? ((modifierValue - 1) & 2) !== 0 ||
					  modifierValue === 9 ||
					  modifierValue === 13 ||
					  modifierValue === 17
					: false;
				if (final === 'D' && (hasCtrl || hasAlt)) {
					moveWordLeft();
					return;
				}
				if (final === 'C' && (hasCtrl || hasAlt)) {
					moveWordRight();
					return;
				}
			}

			// Some terminals emit ESC b / ESC f for word navigation (Option+Arrow fallbacks).
			if (sequence === '\u001bb') {
				moveWordLeft();
				return;
			}
			if (sequence === '\u001bf') {
				moveWordRight();
				return;
			}
		};

		const readToken = (
			data: string
		): { token: InputToken; length: number } | null => {
			if (!data) {
				return null;
			}
			const first = data[0];
			if (first === '\u001b') {
				if (data.length === 1) {
					return null;
				}
				const second = data[1];
				if (second === '[') {
					for (let index = 2; index < data.length; index += 1) {
						const char = data[index];
						if (char >= '@' && char <= '~') {
							return {
								token: {
									kind: 'escape',
									sequence: data.slice(0, index + 1),
								},
								length: index + 1,
							};
						}
					}
					return null;
				}
				if (second === 'O') {
					if (data.length < 3) {
						return null;
					}
					return {
						token: {
							kind: 'escape',
							sequence: data.slice(0, 3),
						},
						length: 3,
					};
				}
				return {
					token: { kind: 'escape', sequence: data.slice(0, 2) },
					length: 2,
				};
			}
			return {
				token: { kind: 'char', value: first },
				length: 1,
			};
		};

		const processInput = (data: string) => {
			pending += data;
			while (pending) {
				const result = readToken(pending);
				if (!result) {
					break;
				}
				pending = pending.slice(result.length);
				handleToken(result.token);
			}
		};
		const handlePrintable = (value: string) => {
			insertText(value);
		};

		const handleToken = (token: InputToken) => {
			if (token.kind === 'escape') {
				if (token.sequence === '\u001b') {
					cancelSearch();
					return;
				}
				if (searchActive) {
					applySearchMatch();
				}
				interpretEscape(token.sequence);
				return;
			}

			const value = token.value;
			const code = value.charCodeAt(0);

			if (searchActive) {
				switch (code) {
					case 3:
					case 7:
					case 27:
						cancelSearch();
						return;
					case 18:
						nextSearchMatch();
						return;
					case 19:
						previousSearchMatch();
						return;
					case 8:
					case 127:
						if (searchQuery) {
							searchQuery = searchQuery.slice(0, -1);
							updateSearchMatches();
						}
						emitSearch();
						return;
					case 10:
					case 13:
						applySearchMatch();
						handleSubmit();
						return;
					default:
						if (code >= 32) {
							searchQuery += value;
							updateSearchMatches();
							emitSearch();
							return;
						}
				}
				applySearchMatch();
			}

			switch (code) {
				case 0:
					return;
				case 1:
					clampCursor(0);
					render();
					return;
				case 2:
					moveCursorLeft();
					return;
				case 3:
					handleInterrupt();
					return;
				case 4:
					if (!buffer) {
						handleExit();
					} else {
						deleteRight();
					}
					return;
				case 5:
					clampCursor(buffer.length);
					render();
					return;
				case 6:
					moveCursorRight();
					return;
				case 7:
					return;
				case 8:
				case 127:
					deleteLeft();
					return;
				case 9:
					handleCompletions();
					return;
				case 10:
					if (ignoreNextLineFeed) {
						ignoreNextLineFeed = false;
						return;
					}
					handleSubmit();
					return;
				case 11:
					deleteToEnd();
					return;
				case 12:
					handleClear();
					return;
				case 13:
					ignoreNextLineFeed = true;
					handleSubmit();
					return;
				case 14:
					navigateHistory(1);
					return;
				case 16:
					navigateHistory(-1);
					return;
				case 18:
					ensureSearchActive();
					return;
				case 19:
					if (searchActive) {
						previousSearchMatch();
					}
					return;
				case 21:
					deleteToStart();
					return;
				case 23:
					deleteWordLeft();
					return;
				default:
					if (value >= ' ') {
						handlePrintable(value);
					}
			}
		};

		const stdin = processController.stdin;
		if (!stdin || typeof stdin.on !== 'function') {
			processController.stderr?.write(
				'tty-shell: interactive stdin is unavailable\n'
			);
			exitSafely(1);
			return;
		}

		const handleData = (chunk: unknown) => {
			try {
				const text =
					typeof chunk === 'string'
						? chunk
						: decoder.decode(chunk as Uint8Array);
				processInput(text);
			} catch (error) {
				processController.stderr?.write(
					`tty-shell: error: ${errorToString(error)}\n`
				);
			}
		};

		const cleanup = () => {
			stdin.off?.('data', handleData as any);
		};

		stdin.on('data', handleData as any);
		stdin.once?.('end', () => {
			cleanup();
			exitSafely(0);
		}) ??
			stdin.on?.('end', () => {
				cleanup();
				exitSafely(0);
			});
		stdin.once?.('close', () => {
			cleanup();
			exitSafely(0);
		}) ??
			stdin.on?.('close', () => {
				cleanup();
				exitSafely(0);
			});

		// Initial render
		render();

		return new Promise(() => {
			// @TODO: resolve on exit.
		});
	};

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
		pathsModuleUrl,
		runModuleUrl,
		parseModuleUrl,
	})});`;
};

export const ttyShellProgramSource = createProgramSource();
