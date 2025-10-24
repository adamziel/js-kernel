var __classPrivateFieldGet =
	(this && this.__classPrivateFieldGet) ||
	function (receiver, state, kind, f) {
		if (kind === 'a' && !f)
			throw new TypeError(
				'Private accessor was defined without a getter'
			);
		if (
			typeof state === 'function'
				? receiver !== state || !f
				: !state.has(receiver)
		)
			throw new TypeError(
				'Cannot read private member from an object whose class did not declare it'
			);
		return kind === 'm'
			? f
			: kind === 'a'
			? f.call(receiver)
			: f
			? f.value
			: state.get(receiver);
	};
var __classPrivateFieldSet =
	(this && this.__classPrivateFieldSet) ||
	function (receiver, state, value, kind, f) {
		if (kind === 'm') throw new TypeError('Private method is not writable');
		if (kind === 'a' && !f)
			throw new TypeError(
				'Private accessor was defined without a setter'
			);
		if (
			typeof state === 'function'
				? receiver !== state || !f
				: !state.has(receiver)
		)
			throw new TypeError(
				'Cannot write private member to an object whose class did not declare it'
			);
		return (
			kind === 'a'
				? f.call(receiver, value)
				: f
				? (f.value = value)
				: state.set(receiver, value),
			value
		);
	};
var _ChildProcessPolyfill_finishListeners,
	_ChildProcessPolyfill_killListeners,
	_ChildProcessPolyfill_finished,
	_ChildProcessPolyfill_customKill,
	_ChildProcessPolyfill_refed;
import { EventEmitter } from '../../../node/lib/events.js';
import { PassThrough } from '../../../node/lib/stream.js';
const sharedDecoder =
	typeof TextDecoder !== 'undefined' ? new TextDecoder() : undefined;
const randomPid = (() => {
	let next = 1000;
	return () => next++;
})();
class ChildProcessPolyfill extends EventEmitter {
	constructor(stdio) {
		super();
		this.exitCode = null;
		this.signalCode = null;
		this.killed = false;
		_ChildProcessPolyfill_finishListeners.set(this, []);
		_ChildProcessPolyfill_killListeners.set(this, []);
		_ChildProcessPolyfill_finished.set(this, false);
		_ChildProcessPolyfill_customKill.set(this, null);
		_ChildProcessPolyfill_refed.set(this, true);
		this.stdin = stdio.stdin;
		this.stdout = stdio.stdout;
		this.stderr = stdio.stderr;
		this.pid = randomPid();
	}
	finish(code, signal) {
		if (__classPrivateFieldGet(this, _ChildProcessPolyfill_finished, 'f')) {
			return;
		}
		__classPrivateFieldSet(this, _ChildProcessPolyfill_finished, true, 'f');
		this.exitCode = code;
		this.signalCode = signal;
		const stdout = this.stdout;
		const stderr = this.stderr;
		stdout === null || stdout === void 0 ? void 0 : stdout.end();
		stderr === null || stderr === void 0 ? void 0 : stderr.end();
		__classPrivateFieldGet(
			this,
			_ChildProcessPolyfill_finishListeners,
			'f'
		).forEach((listener) => listener());
		this.emit('exit', code, signal);
		this.emit('close', code, signal);
	}
	onFinish(listener) {
		__classPrivateFieldGet(
			this,
			_ChildProcessPolyfill_finishListeners,
			'f'
		).push(listener);
	}
	onKill(listener) {
		__classPrivateFieldGet(
			this,
			_ChildProcessPolyfill_killListeners,
			'f'
		).push(listener);
	}
	kill(signal = 'SIGTERM') {
		if (__classPrivateFieldGet(this, _ChildProcessPolyfill_finished, 'f')) {
			return false;
		}
		this.killed = true;
		for (const listener of __classPrivateFieldGet(
			this,
			_ChildProcessPolyfill_killListeners,
			'f'
		)) {
			listener(signal);
		}
		const customKill = __classPrivateFieldGet(
			this,
			_ChildProcessPolyfill_customKill,
			'f'
		);
		if (customKill) {
			const result = customKill(signal);
			if (result === false) {
				return false;
			}
			if (result === true) {
				return true;
			}
		}
		this.finish(1, signal);
		return true;
	}
	setKillImplementation(handler) {
		__classPrivateFieldSet(
			this,
			_ChildProcessPolyfill_customKill,
			handler,
			'f'
		);
	}
	ref() {
		__classPrivateFieldSet(this, _ChildProcessPolyfill_refed, true, 'f');
		return this;
	}
	unref() {
		__classPrivateFieldSet(this, _ChildProcessPolyfill_refed, false, 'f');
		return this;
	}
}
(_ChildProcessPolyfill_finishListeners = new WeakMap()),
	(_ChildProcessPolyfill_killListeners = new WeakMap()),
	(_ChildProcessPolyfill_finished = new WeakMap()),
	(_ChildProcessPolyfill_customKill = new WeakMap()),
	(_ChildProcessPolyfill_refed = new WeakMap());

const createStream = () => new PassThrough();
const removeNodeListener = (emitter, event, listener) => {
	if (!emitter || typeof listener !== 'function') {
		return;
	}
	if (typeof emitter.off === 'function') {
		emitter.off(event, listener);
	} else if (typeof emitter.removeListener === 'function') {
		emitter.removeListener(event, listener);
	}
};
const normaliseStdioMode = (mode, fallback = 'pipe') => {
	if (mode === 'pipe' || mode === 'ignore' || mode === 'inherit') {
		return mode;
	}
	if (typeof mode === 'string' && mode.length > 0) {
		return mode === 'ipc' ? 'pipe' : fallback;
	}
	return fallback;
};
const normaliseStdio = (stdio) => {
	const config = {
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe',
	};
	if (Array.isArray(stdio)) {
		if (stdio.length > 0) {
			config.stdin = normaliseStdioMode(stdio[0], 'pipe');
		}
		if (stdio.length > 1) {
			config.stdout = normaliseStdioMode(stdio[1], 'pipe');
		}
		if (stdio.length > 2) {
			config.stderr = normaliseStdioMode(stdio[2], 'pipe');
		}
	} else if (typeof stdio === 'string') {
		config.stdin = normaliseStdioMode(stdio, 'pipe');
		config.stdout = normaliseStdioMode(stdio, 'pipe');
		config.stderr = normaliseStdioMode(stdio, 'pipe');
	} else if (stdio && typeof stdio === 'object') {
		const value = stdio;
		if ('stdin' in value) {
			config.stdin = normaliseStdioMode(value.stdin, 'pipe');
		}
		if ('stdout' in value) {
			config.stdout = normaliseStdioMode(value.stdout, 'pipe');
		}
		if ('stderr' in value) {
			config.stderr = normaliseStdioMode(value.stderr, 'pipe');
		}
	}
	const streams = {
		stdin: config.stdin === 'pipe' ? createStream() : null,
		stdout: config.stdout === 'pipe' ? createStream() : null,
		stderr: config.stderr === 'pipe' ? createStream() : null,
	};
	return { streams, config };
};
const emitSpawnError = (child, error) => {
	queueMicrotask(() => {
		child.emit('error', error);
		child.finish(error.code === 'ENOENT' ? 127 : 1, null);
	});
};
const toSpawnArg = (value) =>
	value == null ? '' : typeof value === 'string' ? value : String(value);
const normalizeCommand = (command) => {
	const value = toSpawnArg(command);
	if (!value) {
		throw new Error('spawn requires a command');
	}
	return value;
};
const normalizeArgs = (args) =>
	Array.isArray(args) ? args.map((value) => toSpawnArg(value)) : [];
const coerceWritableChunk = (chunk) => {
	if (typeof chunk === 'string') {
		return chunk;
	}
	if (typeof Buffer !== 'undefined') {
		try {
			return Buffer.from(chunk);
		} catch {
			return chunk;
		}
	}
	return chunk;
};
const normalizeSpawnError = (error) => {
	const normalised =
		error instanceof Error
			? error
			: new Error(String(error ?? 'spawn failed'));
	if (!('code' in normalised) && /exit code 127/i.test(normalised.message)) {
		normalised.code = 'ENOENT';
		normalised.errno = 'ENOENT';
	}
	return normalised;
};
const createSpawnOptions = (command, args, options, stdioConfig) => {
	const env =
		options && typeof options.env === 'object' ? options.env : undefined;
	const cwd =
		options && typeof options.cwd === 'string' && options.cwd.length
			? options.cwd
			: undefined;
	const timeout =
		options &&
		typeof options.timeout === 'number' &&
		Number.isFinite(options.timeout)
			? Math.max(0, options.timeout)
			: undefined;
	return {
		argv: [command, ...args],
		env,
		cwd,
		stdio: stdioConfig,
		timeout,
	};
};
const detachFromReadable = (detach) => {
	if (typeof detach !== 'function') {
		return;
	}
	try {
		detach();
	} catch {
		// ignore
	}
};
const runHandler = async (child, command, args, options, handler) => {
	var _a;
	let finished = false;
	const exit = (code = 0, signal = null) => {
		if (finished) {
			return;
		}
		finished = true;
		child.finish(code, signal);
	};
	child.onFinish(() => {
		finished = true;
	});
	const context = {
		command,
		args,
		options,
		stdin: child.stdin,
		stdout: child.stdout,
		stderr: child.stderr,
		writeStdout: (data) => {
			var _a;
			try {
				if (
					commandText === 'node' &&
					Array.isArray(argumentList) &&
					argumentList.some((arg) =>
						typeof arg === 'string' && arg.includes('esbuild')
					)
				) {
					const length =
						typeof data === 'string'
							? data.length
							: data && typeof data === 'object'
							? data.byteLength ?? data.length ?? 0
							: 0;
					let preview;
					if (typeof data === 'string') {
						preview = data.slice(0, 80);
					} else if (data && typeof data === 'object') {
						const view = data instanceof Uint8Array
							? data
							: ArrayBuffer.isView(data)
							? new Uint8Array(
									data.buffer,
									data.byteOffset ?? 0,
									Math.min(data.byteLength ?? data.length ?? 0, 128)
							  )
							: null;
						if (view) {
							preview = Buffer.from(view).toString('base64');
						}
					}
					console.log('[spawn] esbuild stdout chunk', {
						length,
						type: data && data.constructor && data.constructor.name,
						preview,
					});
				}
			} catch {
				// ignore logging errors
			}
			(_a = child.stdout) === null || _a === void 0
				? void 0
				: _a.write(data);
		},
		writeStderr: (data) => {
			var _a;
			try {
				if (
					commandText === 'node' &&
					Array.isArray(argumentList) &&
					argumentList.some((arg) =>
						typeof arg === 'string' && arg.includes('esbuild')
					)
				) {
					const length =
						typeof data === 'string'
							? data.length
							: data && typeof data === 'object'
							? data.byteLength ?? data.length ?? 0
							: 0;
					console.log('[spawn] esbuild stderr chunk', {
						length,
						type: data && data.constructor && data.constructor.name,
						preview:
							typeof data === 'string'
								? data.slice(0, 200)
								: undefined,
					});
				}
			} catch {
				// ignore logging errors
			}
			(_a = child.stderr) === null || _a === void 0
				? void 0
				: _a.write(data);
		},
		exit,
		onKill: (listener) => child.onKill(listener),
	};
	if (options.signal) {
		const abortHandler = () => {
			if (!finished) {
				child.emit(
					'error',
					Object.assign(new Error('The operation was aborted'), {
						name: 'AbortError',
					})
				);
			}
			child.kill('SIGABRT');
		};
		if (options.signal.aborted) {
			abortHandler();
			return;
		}
		options.signal.addEventListener('abort', abortHandler, { once: true });
		child.onFinish(() => {
			var _a;
			return (_a = options.signal) === null || _a === void 0
				? void 0
				: _a.removeEventListener('abort', abortHandler);
		});
	}
	try {
		const result = await handler(context);
		if (!finished) {
			const code =
				result &&
				typeof result === 'object' &&
				'code' in result &&
				typeof result.code === 'number'
					? result.code
					: 0;
			const signal =
				result && typeof result === 'object' && 'signal' in result
					? (_a = result.signal) !== null && _a !== void 0
						? _a
						: null
					: null;
			exit(code, signal);
		}
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		child.emit('error', error);
		if (!finished) {
			const code =
				(error === null || error === void 0 ? void 0 : error.code) &&
				typeof error.code === 'number'
					? error.code
					: 1;
			exit(code, null);
		}
	}
};
export const spawn = (command, args = [], options = {}) => {
	const commandText = normalizeCommand(command);
	const argumentList = normalizeArgs(args);
	const { streams, config } = normaliseStdio(options.stdio);
	const child = new ChildProcessPolyfill(streams);
	queueMicrotask(() => {
		if (
			!globalThis.processController ||
			typeof globalThis.processController.spawnNodeProcess !== 'function'
		) {
			const error = new Error(
				'processController.spawnNodeProcess is not available'
			);
			error.code = 'ERR_SPAWN_UNAVAILABLE';
			emitSpawnError(child, error);
			return;
		}
		runHandler(
			child,
			commandText,
			argumentList,
			options,
			async (context) => {
				const spawnOptions = createSpawnOptions(
					commandText,
					argumentList,
					options,
					config
				);
				const detachments = [];
				child.onFinish(() => {
					for (const detach of detachments.splice(0)) {
						try {
							detach();
						} catch {
							// ignore
						}
					}
				});
				let handle = null;
				let pendingKillSignal = null;
				const dispatchKill = (target, signal) => {
					if (!target) {
						return false;
					}
					try {
						if (typeof target.signal === 'function') {
							target.signal(signal);
						} else if (typeof target.terminate === 'function') {
							target.terminate();
						}
						return true;
					} catch {
						return false;
					}
				};
				child.setKillImplementation((signal = 'SIGTERM') => {
					if (handle) {
						return dispatchKill(handle, signal);
					}
					pendingKillSignal = signal;
					return true;
				});
				const pendingInput = [];
				let stdinEnded = false;
				if (context.stdin) {
					const handleData = (chunk) => {
						if (handle && handle.stdin) {
							try {
								handle.stdin.write(chunk);
							} catch {
								// ignore
							}
							return;
						}
						pendingInput.push(chunk);
					};
					const handleEnd = () => {
						if (handle && handle.stdin) {
							try {
								handle.stdin.end();
							} catch {
								// ignore
							}
							return;
						}
						stdinEnded = true;
					};
					context.stdin.on('data', handleData);
					context.stdin.on('end', handleEnd);
					context.stdin.on('close', handleEnd);
					detachments.push(() =>
						removeNodeListener(context.stdin, 'data', handleData)
					);
					detachments.push(() =>
						removeNodeListener(context.stdin, 'end', handleEnd)
					);
					detachments.push(() =>
						removeNodeListener(context.stdin, 'close', handleEnd)
					);
				}
				const flushPendingInput = () => {
					if (!handle || !handle.stdin) {
						pendingInput.splice(0);
						return;
					}
					for (const chunk of pendingInput.splice(0)) {
						try {
							handle.stdin.write(chunk);
						} catch {
							// ignore
						}
					}
					if (stdinEnded) {
						try {
							handle.stdin.end();
						} catch {
							// ignore
						}
					}
				};
			try {
				handle =
					await globalThis.processController.spawnNodeProcess(
						spawnOptions
					);
			} catch (error) {
				throw normalizeSpawnError(error);
			}
			if (
				handle &&
				handle.stdin &&
				typeof handle.stdin.write === 'function' &&
				commandText === 'node' &&
				Array.isArray(argumentList) &&
				argumentList.some((arg) =>
					typeof arg === 'string' && arg.includes('esbuild')
				)
			) {
				const originalWrite = handle.stdin.write.bind(handle.stdin);
				handle.stdin.write = (chunk) => {
					try {
						const length =
							typeof chunk === 'string'
								? chunk.length
								: chunk && typeof chunk === 'object'
							? chunk.byteLength ?? chunk.length ?? 0
							: 0;
					let preview;
					if (typeof chunk === 'string') {
						preview = chunk.slice(0, 80);
					} else if (chunk && typeof chunk === 'object') {
						const view = chunk instanceof Uint8Array
							? chunk
							: ArrayBuffer.isView(chunk)
							? new Uint8Array(
									chunk.buffer,
									chunk.byteOffset ?? 0,
									Math.min(chunk.byteLength ?? chunk.length ?? 0, 128)
							  )
							: null;
						if (view) {
							preview = Buffer.from(view).toString('base64');
						}
					}
					console.log('[spawn] esbuild stdin write', {
						length,
						type: chunk && chunk.constructor && chunk.constructor.name,
						preview,
					});
					} catch {
						// ignore logging errors
					}
					return originalWrite(chunk);
				};
			}
				if (typeof handle.threadId === 'number') {
					child.pid = handle.threadId;
				}
				flushPendingInput();
				if (pendingKillSignal) {
					dispatchKill(handle, pendingKillSignal);
					pendingKillSignal = null;
				}
				const attachReadable = (stream, onData, onEnd) => {
					if (!stream) {
						return;
					}
					const detachData = stream.on('data', onData);
					const endOnce = (() => {
						let ended = false;
						return () => {
							if (ended) {
								return;
							}
							ended = true;
							onEnd();
						};
					})();
					const detachEnd = stream.on('end', endOnce);
					const detachClose = stream.on('close', endOnce);
					detachments.push(() => detachFromReadable(detachData));
					detachments.push(() => detachFromReadable(detachEnd));
					detachments.push(() => detachFromReadable(detachClose));
				};
				if (handle.stdout && context.stdout) {
					attachReadable(
						handle.stdout,
						(chunk) =>
							context.writeStdout(coerceWritableChunk(chunk)),
						() => {
							try {
								context.stdout.end();
							} catch {
								// ignore
							}
						}
					);
				} else if (
					handle.stdout &&
					typeof handle.stdout.destroy === 'function'
				) {
					handle.stdout.destroy();
				}
				if (handle.stderr && context.stderr) {
					attachReadable(
						handle.stderr,
						(chunk) =>
							context.writeStderr(coerceWritableChunk(chunk)),
						() => {
							try {
								context.stderr.end();
							} catch {
								// ignore
							}
						}
					);
				} else if (
					handle.stderr &&
					typeof handle.stderr.destroy === 'function'
				) {
					handle.stderr.destroy();
				}
				queueMicrotask(() => child.emit('spawn'));
			const exitInfo = await handle.waitForExit();
			try {
				if (
					commandText === 'node' &&
					Array.isArray(argumentList) &&
					argumentList.some((arg) =>
						typeof arg === 'string' && arg.includes('esbuild')
					)
				) {
					console.log('[spawn] esbuild child exited', {
						command: commandText,
						args: argumentList,
						code: exitInfo && 'code' in exitInfo ? exitInfo.code : null,
						signal:
							exitInfo && 'signal' in exitInfo ? exitInfo.signal : null,
					});
				}
			} catch {
				// ignore logging errors
			}
				return exitInfo ?? { code: 0, signal: null };
			}
		);
	});
	return child;
};
const decodeSpawnSyncOutput = (text, encoding) => {
	const actual = typeof text === 'string' ? text : '';
	if (encoding === null) {
		if (typeof Buffer !== 'undefined') {
			return Buffer.from(actual);
		}
		return actual;
	}
	if (!encoding || encoding === 'utf8' || encoding === 'utf-8') {
		return actual;
	}
	if (typeof Buffer !== 'undefined') {
		try {
			return Buffer.from(actual, encoding).toString(encoding);
		} catch {
			return actual;
		}
	}
	return actual;
};
const resolveSpawnSyncEncoding = (encoding) => {
	if (encoding === null || encoding === 'buffer') {
		return null;
	}
	if (typeof encoding === 'string' && encoding.length > 0) {
		return encoding;
	}
	return null;
};
const createEmptyOutput = () =>
	typeof Buffer !== 'undefined' && typeof Buffer.alloc === 'function'
		? Buffer.alloc(0)
		: '';
export const spawnSync = (command, args = [], options = {}) => {
	if (
		!globalThis.processController ||
		typeof globalThis.processController.spawnSync !== 'function'
	) {
		const error = new Error('processController.spawnSync is not available');
		return {
			pid: 0,
			output: [createEmptyOutput(), createEmptyOutput()],
			stdout: createEmptyOutput(),
			stderr: createEmptyOutput(),
			status: null,
			signal: null,
			error,
		};
	}
	const commandText = normalizeCommand(command);
	const argumentList = normalizeArgs(args);
	const { config } = normaliseStdio(options.stdio);
	const spawnOptions = createSpawnOptions(
		commandText,
		argumentList,
		options,
		config
	);
	let outcome;
	try {
		outcome = globalThis.processController.spawnSync(spawnOptions);
	} catch (error) {
		const normalised =
			error instanceof Error
				? error
				: new Error(String(error ?? 'spawnSync failed'));
		return {
			pid: 0,
			output: [createEmptyOutput(), createEmptyOutput()],
			stdout: createEmptyOutput(),
			stderr: createEmptyOutput(),
			status: null,
			signal: null,
			error: normalised,
		};
	}
	const encoding = resolveSpawnSyncEncoding(options.encoding);
	const stdout = decodeSpawnSyncOutput(outcome.stdout ?? '', encoding);
	const stderr = decodeSpawnSyncOutput(outcome.stderr ?? '', encoding);
	const output = [stdout, stderr];
	let error = undefined;
	if (outcome.error) {
		error = new Error(outcome.error);
		if (/command not found/i.test(outcome.error)) {
			error.code = 'ENOENT';
			error.errno = 'ENOENT';
		}
	}
	return {
		pid: 0,
		output,
		stdout,
		stderr,
		status: typeof outcome.status === 'number' ? outcome.status : null,
		signal: null,
		error,
	};
};
export const execFile = (file, args, options, callback) => {
	var _a, _b;
	let actualArgs = [];
	let actualOptions = {};
	let actualCallback =
		callback !== null && callback !== void 0 ? callback : null;
	if (Array.isArray(args)) {
		actualArgs = args;
		if (options) {
			actualOptions = options;
		}
	} else if (args && typeof args === 'object') {
		actualOptions = args;
	} else if (typeof args === 'function') {
		actualCallback = args;
	}
	if (options && typeof options === 'function') {
		actualCallback = options;
	}
	const child = spawn(file, actualArgs, actualOptions);
	if (!actualCallback) {
		return child;
	}
	let stdout = '';
	let stderr = '';
	(_a = child.stdout) === null || _a === void 0
		? void 0
		: _a.on('data', (chunk) => {
				var _a;
				stdout +=
					typeof chunk === 'string'
						? chunk
						: chunk instanceof Uint8Array
						? (_a =
								sharedDecoder === null ||
								sharedDecoder === void 0
									? void 0
									: sharedDecoder.decode(chunk)) !== null &&
						  _a !== void 0
							? _a
							: String(chunk)
						: String(
								chunk !== null && chunk !== void 0 ? chunk : ''
						  );
		  });
	(_b = child.stderr) === null || _b === void 0
		? void 0
		: _b.on('data', (chunk) => {
				var _a;
				stderr +=
					typeof chunk === 'string'
						? chunk
						: chunk instanceof Uint8Array
						? (_a =
								sharedDecoder === null ||
								sharedDecoder === void 0
									? void 0
									: sharedDecoder.decode(chunk)) !== null &&
						  _a !== void 0
							? _a
							: String(chunk)
						: String(
								chunk !== null && chunk !== void 0 ? chunk : ''
						  );
		  });
	child.once('error', (error) =>
		actualCallback === null || actualCallback === void 0
			? void 0
			: actualCallback(error, stdout, stderr)
	);
	child.once('close', (code, signal) => {
		if (code && code !== 0) {
			const error = Object.assign(new Error(`Command failed: ${file}`), {
				code,
				signal,
			});
			actualCallback === null || actualCallback === void 0
				? void 0
				: actualCallback(error, stdout, stderr);
			return;
		}
		actualCallback === null || actualCallback === void 0
			? void 0
			: actualCallback(null, stdout, stderr);
	});
	return child;
};
export const execFileSync = (file, args, options) => {
	let actualArgs = [];
	let actualOptions = {};
	if (Array.isArray(args)) {
		actualArgs = args;
		if (options && typeof options === 'object') {
			actualOptions = options;
		}
	} else if (args && typeof args === 'object') {
		actualOptions = args;
	} else if (args !== undefined && args !== null) {
		actualArgs = [String(args)];
	}
	const normalizedOptions = { ...actualOptions };
	if (!('encoding' in normalizedOptions)) {
		normalizedOptions.encoding = null;
	} else if (normalizedOptions.encoding === 'buffer') {
		normalizedOptions.encoding = null;
	}
	const result = spawnSync(file, actualArgs, normalizedOptions);
	if (result.error) {
		throw result.error;
	}
	if (typeof result.status === 'number' && result.status !== 0) {
		const error = Object.assign(
			new Error(`Command failed: ${file}`),
			{
				code: result.status,
				signal: result.signal ?? null,
				stdout: result.stdout,
				stderr: result.stderr,
			}
		);
		throw error;
	}
	return result.stdout;
};
export const exec = (command, options, callback) => {
	var _a;
	let actualOptions = {};
	let actualCallback =
		callback !== null && callback !== void 0 ? callback : null;
	if (typeof options === 'function') {
		actualCallback = options;
	} else if (options) {
		actualOptions = options;
	}
	const parts = command.trim().split(/\s+/);
	const file = (_a = parts.shift()) !== null && _a !== void 0 ? _a : '';
	if (!file) {
		throw new Error('exec requires a command to run');
	}
	return execFile(
		file,
		parts,
		actualOptions,
		actualCallback !== null && actualCallback !== void 0
			? actualCallback
			: undefined
	);
};
export const fork = (modulePath, args, options) => {
	var _a;
	const actualArgs = Array.isArray(args) ? args : [];
	const actualOptions =
		(_a =
			options !== null && options !== void 0
				? options
				: Array.isArray(args)
				? undefined
				: args) !== null && _a !== void 0
			? _a
			: {};
	return spawn(modulePath, actualArgs, actualOptions);
};
export const ChildProcess = ChildProcessPolyfill;
export default {
	spawn,
	spawnSync,
	execFileSync,
	exec,
	execFile,
	fork,
	ChildProcess,
};
