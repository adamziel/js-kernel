var __classPrivateFieldGet =
	(this && this.__classPrivateFieldGet) ||
	function (receiver, state, kind, f) {
		if (kind === 'a' && !f)
			throw new TypeError('Private accessor was defined without a getter')
		if (
			typeof state === 'function'
				? receiver !== state || !f
				: !state.has(receiver)
		)
			throw new TypeError(
				'Cannot read private member from an object whose class did not declare it'
			)
		return kind === 'm'
			? f
			: kind === 'a'
			? f.call(receiver)
			: f
			? f.value
			: state.get(receiver)
	}
var __classPrivateFieldSet =
	(this && this.__classPrivateFieldSet) ||
	function (receiver, state, value, kind, f) {
		if (kind === 'm') throw new TypeError('Private method is not writable')
		if (kind === 'a' && !f)
			throw new TypeError('Private accessor was defined without a setter')
		if (
			typeof state === 'function'
				? receiver !== state || !f
				: !state.has(receiver)
		)
			throw new TypeError(
				'Cannot write private member to an object whose class did not declare it'
			)
		return (
			kind === 'a'
				? f.call(receiver, value)
				: f
				? (f.value = value)
				: state.set(receiver, value),
			value
		)
	}
var _ChildProcessPolyfill_finishListeners,
	_ChildProcessPolyfill_killListeners,
	_ChildProcessPolyfill_finished
import { EventEmitter } from '../../../node/lib/events.js'
import { PassThrough } from '../../../node/lib/stream.js'
const sharedDecoder =
	typeof TextDecoder !== 'undefined' ? new TextDecoder() : undefined
const randomPid = (() => {
	let next = 1000
	return () => next++
})()
class ChildProcessPolyfill extends EventEmitter {
	constructor(stdio) {
		super()
		this.exitCode = null
		this.signalCode = null
		this.killed = false
		_ChildProcessPolyfill_finishListeners.set(this, [])
		_ChildProcessPolyfill_killListeners.set(this, [])
		_ChildProcessPolyfill_finished.set(this, false)
		this.stdin = stdio.stdin
		this.stdout = stdio.stdout
		this.stderr = stdio.stderr
		this.pid = randomPid()
	}
	finish(code, signal) {
		if (__classPrivateFieldGet(this, _ChildProcessPolyfill_finished, 'f')) {
			return
		}
		__classPrivateFieldSet(this, _ChildProcessPolyfill_finished, true, 'f')
		this.exitCode = code
		this.signalCode = signal
		const stdout = this.stdout
		const stderr = this.stderr
		stdout === null || stdout === void 0 ? void 0 : stdout.end()
		stderr === null || stderr === void 0 ? void 0 : stderr.end()
		__classPrivateFieldGet(
			this,
			_ChildProcessPolyfill_finishListeners,
			'f'
		).forEach((listener) => listener())
		this.emit('exit', code, signal)
		this.emit('close', code, signal)
	}
	onFinish(listener) {
		__classPrivateFieldGet(
			this,
			_ChildProcessPolyfill_finishListeners,
			'f'
		).push(listener)
	}
	onKill(listener) {
		__classPrivateFieldGet(
			this,
			_ChildProcessPolyfill_killListeners,
			'f'
		).push(listener)
	}
	kill(signal = 'SIGTERM') {
		if (__classPrivateFieldGet(this, _ChildProcessPolyfill_finished, 'f')) {
			return false
		}
		this.killed = true
		for (const listener of __classPrivateFieldGet(
			this,
			_ChildProcessPolyfill_killListeners,
			'f'
		)) {
			listener(signal)
		}
		this.finish(1, signal)
		return true
	}
}
;(_ChildProcessPolyfill_finishListeners = new WeakMap()),
	(_ChildProcessPolyfill_killListeners = new WeakMap()),
	(_ChildProcessPolyfill_finished = new WeakMap())

const createStream = () => new PassThrough()
const normaliseStdio = (stdio) => {
	const settingToStream = (setting) => {
		switch (setting) {
			case 'ignore':
				return null
			case 'inherit':
				return null
			case 'pipe':
			default:
				return createStream()
		}
	}
	if (Array.isArray(stdio)) {
		const [stdinSetting, stdoutSetting, stderrSetting] = stdio
		return {
			stdin: settingToStream(stdinSetting),
			stdout: settingToStream(stdoutSetting),
			stderr: settingToStream(stderrSetting),
		}
	}
	const stdin = settingToStream(typeof stdio === 'string' ? stdio : undefined)
	const stdout = settingToStream(
		typeof stdio === 'string' ? stdio : undefined
	)
	const stderr = settingToStream(
		typeof stdio === 'string' ? stdio : undefined
	)
	return { stdin, stdout, stderr }
}
const emitSpawnError = (child, error) => {
	queueMicrotask(() => {
		child.emit('error', error)
		child.finish(error.code === 'ENOENT' ? 127 : 1, null)
	})
}
const runHandler = async (child, command, args, options, handler) => {
	var _a
	let finished = false
	const exit = (code = 0, signal = null) => {
		if (finished) {
			return
		}
		finished = true
		child.finish(code, signal)
	}
	child.onFinish(() => {
		finished = true
	})
	const context = {
		command,
		args,
		options,
		stdin: child.stdin,
		stdout: child.stdout,
		stderr: child.stderr,
		writeStdout: (data) => {
			var _a
			;(_a = child.stdout) === null || _a === void 0
				? void 0
				: _a.write(data)
		},
		writeStderr: (data) => {
			var _a
			;(_a = child.stderr) === null || _a === void 0
				? void 0
				: _a.write(data)
		},
		exit,
		onKill: (listener) => child.onKill(listener),
	}
	if (options.signal) {
		const abortHandler = () => {
			if (!finished) {
				child.emit(
					'error',
					Object.assign(new Error('The operation was aborted'), {
						name: 'AbortError',
					})
				)
			}
			child.kill('SIGABRT')
		}
		if (options.signal.aborted) {
			abortHandler()
			return
		}
		options.signal.addEventListener('abort', abortHandler, { once: true })
		child.onFinish(() => {
			var _a
			return (_a = options.signal) === null || _a === void 0
				? void 0
				: _a.removeEventListener('abort', abortHandler)
		})
	}
	try {
		const result = await handler(context)
		if (!finished) {
			const code =
				result &&
				typeof result === 'object' &&
				'code' in result &&
				typeof result.code === 'number'
					? result.code
					: 0
			const signal =
				result && typeof result === 'object' && 'signal' in result
					? (_a = result.signal) !== null && _a !== void 0
						? _a
						: null
					: null
			exit(code, signal)
		}
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err))
		child.emit('error', error)
		if (!finished) {
			const code =
				(error === null || error === void 0 ? void 0 : error.code) &&
				typeof error.code === 'number'
					? error.code
					: 1
			exit(code, null)
		}
	}
}
import { spawnNodeProcess } from '../app/spawn-node-process.js'
export const spawn = (command, args = [], options = {}) => {
	const stdio = normaliseStdio(options.stdio)
	const child = new ChildProcessPolyfill(stdio)
	queueMicrotask(() => {
		// @TODO: Support other options
		spawnNodeProcess([command, ...args], {
			options,
		})
		// runHandler(child, command, Array.from(args), options, handler);
	})
	return child
}
export const execFile = (file, args, options, callback) => {
	var _a, _b
	let actualArgs = []
	let actualOptions = {}
	let actualCallback =
		callback !== null && callback !== void 0 ? callback : null
	if (Array.isArray(args)) {
		actualArgs = args
		if (options) {
			actualOptions = options
		}
	} else if (args && typeof args === 'object') {
		actualOptions = args
	} else if (typeof args === 'function') {
		actualCallback = args
	}
	if (options && typeof options === 'function') {
		actualCallback = options
	}
	const child = spawn(file, actualArgs, actualOptions)
	if (!actualCallback) {
		return child
	}
	let stdout = ''
	let stderr = ''
	;(_a = child.stdout) === null || _a === void 0
		? void 0
		: _a.on('data', (chunk) => {
				var _a
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
						  )
		  })
	;(_b = child.stderr) === null || _b === void 0
		? void 0
		: _b.on('data', (chunk) => {
				var _a
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
						  )
		  })
	child.once('error', (error) =>
		actualCallback === null || actualCallback === void 0
			? void 0
			: actualCallback(error, stdout, stderr)
	)
	child.once('close', (code, signal) => {
		if (code && code !== 0) {
			const error = Object.assign(new Error(`Command failed: ${file}`), {
				code,
				signal,
			})
			actualCallback === null || actualCallback === void 0
				? void 0
				: actualCallback(error, stdout, stderr)
			return
		}
		actualCallback === null || actualCallback === void 0
			? void 0
			: actualCallback(null, stdout, stderr)
	})
	return child
}
export const exec = (command, options, callback) => {
	var _a
	let actualOptions = {}
	let actualCallback =
		callback !== null && callback !== void 0 ? callback : null
	if (typeof options === 'function') {
		actualCallback = options
	} else if (options) {
		actualOptions = options
	}
	const parts = command.trim().split(/\s+/)
	const file = (_a = parts.shift()) !== null && _a !== void 0 ? _a : ''
	if (!file) {
		throw new Error('exec requires a command to run')
	}
	return execFile(
		file,
		parts,
		actualOptions,
		actualCallback !== null && actualCallback !== void 0
			? actualCallback
			: undefined
	)
}
export const fork = (modulePath, args, options) => {
	var _a
	const actualArgs = Array.isArray(args) ? args : []
	const actualOptions =
		(_a =
			options !== null && options !== void 0
				? options
				: Array.isArray(args)
				? undefined
				: args) !== null && _a !== void 0
			? _a
			: {}
	return spawn(modulePath, actualArgs, actualOptions)
}
export const ChildProcess = ChildProcessPolyfill
export default {
	spawn,
	exec,
	execFile,
	fork,
	ChildProcess,
}
