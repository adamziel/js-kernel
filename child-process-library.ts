// Request kernel message ports from parent
export const requestKernelPorts = (): Promise<[MessagePort, MessagePort]> => {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(
				new Error(
					'Failed to receive kernel message ports within 1 second'
				)
			)
		}, 1000)

		const handleMessage = (event: MessageEvent) => {
			if (
				event.data?.type === 'kernelMessagePorts' &&
				Array.isArray(event.data.ports) &&
				event.data.ports.length === 2
			) {
				clearTimeout(timeout)
				self.removeEventListener('message', handleMessage)
				resolve([event.data.ports[0], event.data.ports[1]])
			}
		}

		self.addEventListener('message', handleMessage)

		// Request the ports from parent
		self.postMessage({ type: 'requestKernelMessagePorts' })
	})
}

export type StdioMode = 'inherit' | 'ignore' | 'pipe'
export type KernelStdioChunk = string | Uint8Array

interface ChildStdioDescriptor {
	fd: 0 | 1 | 2
	mode: StdioMode
	port?: MessagePort
}

interface ChildProcessInitOptions {
	pid: number
	argv: string[]
	env: Record<string, string>
	cwd: string
	debug: boolean
	stdio: ChildStdioDescriptor[]
	programPath: string
	programSource: string
	controlPort: MessagePort
}

type Listener<Arg> = (value: Arg) => void

class BasicEventEmitter<Events extends Record<string, unknown>> {
	private listeners: {
		[K in keyof Events]?: Set<Listener<Events[K]>>
	} = {}

	on<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		if (!this.listeners[event]) {
			this.listeners[event] = new Set()
		}
		this.listeners[event]!.add(listener)
		return () => this.off(event, listener)
	}

	once<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		const wrapper: Listener<Events[K]> = (value) => {
			this.off(event, wrapper)
			listener(value)
		}
		return this.on(event, wrapper)
	}

	off<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		const listeners = this.listeners[event]
		if (!listeners) return
		listeners.delete(listener)
		if (listeners.size === 0) {
			delete this.listeners[event]
		}
	}

	protected emit<K extends keyof Events>(event: K, value: Events[K]) {
		const listeners = this.listeners[event]
		if (!listeners) return
		for (const listener of Array.from(listeners)) {
			listener(value)
		}
	}

	protected clearAll() {
		this.listeners = {}
	}
}

const CONTROL_MESSAGE_SPAWN_REQUEST = '__kernel_internal__/spawnRequest'
const CONTROL_MESSAGE_SPAWN_RESULT = '__kernel_internal__/spawnResult'
const CONTROL_MESSAGE_KILL_RESULT = '__kernel_internal__/killResult'

interface ProcessControllerSpawnOptions {
	argv: string[]
	env?: Record<string, string>
	cwd?: string
	name?: string
	debug?: boolean
	stdio?: {
		stdin?: StdioMode
		stdout?: StdioMode
		stderr?: StdioMode
	}
}

interface ChildReadableEvents {
	data: KernelStdioChunk
	end: void
	close: void
}

class ChildReadableStream extends BasicEventEmitter<ChildReadableEvents> {
	private readonly mode: StdioMode
	private readonly port?: MessagePort
	private readonly handleMessage = (event: MessageEvent) => {
		const payload = event.data
		if (!payload || typeof payload !== 'object') {
			return
		}
		if (payload.type === 'data') {
			this.emit('data', payload.payload)
		} else if (payload.type === 'end') {
			this.emit('end', undefined as unknown as void)
			this.close()
		} else if (payload.type === 'close') {
			this.close()
		}
	}
	private closed = false

	constructor(descriptor: ChildStdioDescriptor) {
		super()
		this.mode = descriptor.mode
		this.port = descriptor.port

		if (this.mode === 'ignore' || !this.port) {
			this.closed = true
			return
		}

		this.port.addEventListener('message', this.handleMessage)
		this.port.start()
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.port?.removeEventListener('message', this.handleMessage)
		this.port?.close()
		this.emit('close', undefined as unknown as void)
		this.clearAll()
	}

	destroy() {
		this.close()
	}
}

interface ChildWritableEvents {
	close: void
}

class ChildWritableStream extends BasicEventEmitter<ChildWritableEvents> {
	private readonly mode: StdioMode
	private readonly port?: MessagePort
	private closed = false

	constructor(descriptor: ChildStdioDescriptor) {
		super()
		this.mode = descriptor.mode
		this.port = descriptor.port
		this.port?.start()
	}

	write(chunk: KernelStdioChunk) {
		if (this.closed || this.mode === 'ignore' || !this.port) {
			return false
		}
		try {
			this.port.postMessage({ type: 'data', payload: chunk })
			return true
		} catch {
			this.destroy()
			return false
		}
	}

	end(chunk?: KernelStdioChunk) {
		if (this.closed) return false
		if (typeof chunk !== 'undefined') {
			this.write(chunk)
		}
		this.signalAndClose('end')
		return true
	}

	close() {
		if (this.closed) return false
		this.signalAndClose('close')
		return true
	}

	destroy() {
		if (this.closed) return
		this.closed = true
		this.port?.close()
		this.emit('close', undefined as unknown as void)
		this.clearAll()
	}

	private signalAndClose(type: 'end' | 'close') {
		try {
			this.port?.postMessage({ type })
		} catch {
			// Ignore failures while closing the port.
		} finally {
			this.destroy()
		}
	}
}

interface ChildStdioStreams {
	stdin: ChildReadableStream
	stdout: ChildWritableStream
	stderr: ChildWritableStream
}

const getDescriptorByFd = (
	descriptors: ChildStdioDescriptor[],
	fd: 0 | 1 | 2
) =>
	descriptors.find((descriptor) => descriptor.fd === fd) ?? {
		fd,
		mode: 'ignore' as StdioMode,
	}

const createChildStdio = (
	descriptors: ChildStdioDescriptor[]
): ChildStdioStreams => {
	const stdinDescriptor = getDescriptorByFd(descriptors, 0)
	const stdoutDescriptor = getDescriptorByFd(descriptors, 1)
	const stderrDescriptor = getDescriptorByFd(descriptors, 2)

	return {
		stdin: new ChildReadableStream(stdinDescriptor),
		stdout: new ChildWritableStream(stdoutDescriptor),
		stderr: new ChildWritableStream(stderrDescriptor),
	}
}

const toKernelChunk = (value: unknown): KernelStdioChunk => {
	if (typeof value === 'string') {
		return value
	}
	if (value instanceof Uint8Array) {
		return value
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value)
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView
		return new Uint8Array(
			view.buffer,
			view.byteOffset,
			view.byteLength
		).slice()
	}
	if (value === null || typeof value === 'undefined') {
		return String(value)
	}
	try {
		if (typeof value === 'object') {
			const json = JSON.stringify(value)
			return typeof json === 'string' ? json : String(value)
		}
		return String(value)
	} catch {
		return String(value)
	}
}

const appendTrailingNewlineIfText = (
	chunk: KernelStdioChunk
): KernelStdioChunk => {
	if (typeof chunk === 'string') {
		return chunk.endsWith('\n') ? chunk : `${chunk}\n`
	}
	return chunk
}

let childProcessState: ChildProcessInitOptions | null = null
let stdioStreams: ChildStdioStreams | null = null
let controlPort: MessagePort | null = null
let bootstrapComplete = false
let programStarted = false
let nextSpawnRequestId = 1
const pendingSpawnRequests = new Map<
	number,
	{
		resolve: (pid: number) => void
		reject: (error: Error) => void
	}
>()

const failAllPendingSpawnRequests = (reason: string) => {
	const error =
		reason instanceof Error
			? reason
			: new Error(reason || 'Spawn request cancelled')
	for (const { reject } of pendingSpawnRequests.values()) {
		reject(error)
	}
	pendingSpawnRequests.clear()
}

const cleanupControlPort = (reason?: string) => {
	if (!controlPort) {
		return
	}
	controlPort.removeEventListener('message', handleControlResponse)
	try {
		controlPort.close()
	} catch {
		// Ignore failures during control port cleanup.
	}
	controlPort = null
	failAllPendingSpawnRequests(
		reason ?? 'Control channel closed before spawn response'
	)
}

function handleControlResponse(event: MessageEvent) {
	const payload = event.data
	if (!payload || typeof payload !== 'object') {
		return
	}

	if (payload.type === CONTROL_MESSAGE_SPAWN_RESULT) {
		const requestId = payload.requestId
		if (typeof requestId !== 'number') {
			return
		}
		const pending = pendingSpawnRequests.get(requestId)
		if (!pending) {
			return
		}
		pendingSpawnRequests.delete(requestId)

		if (payload.error && typeof payload.error.code === 'number') {
			pending.reject(
				new Error(
					`Spawn failed with exit code ${payload.error.code}`
				)
			)
		} else if (
			payload.result &&
			typeof payload.result.pid === 'number'
		) {
			pending.resolve(payload.result.pid)
		} else {
			pending.reject(new Error('Spawn result missing pid'))
		}
	} else if (payload.type === CONTROL_MESSAGE_KILL_RESULT) {
		// Kill acknowledgements are not tracked yet.
	}
}

const cloneEnvRecord = (
	env?: Record<string, string>
): Record<string, string> => {
	if (!env) {
		return {}
	}
	const cloned: Record<string, string> = {}
	for (const [key, value] of Object.entries(env)) {
		cloned[key] = value
	}
	return cloned
}

const requestSpawnFromKernel = (
	options: ProcessControllerSpawnOptions
): Promise<number> => {
	if (!childProcessState) {
		return Promise.reject(
			new Error('processController.spawn is unavailable before init')
		)
	}
	if (!controlPort) {
		return Promise.reject(
			new Error('processController.spawn is not available')
		)
	}
	if (!options || !Array.isArray(options.argv) || options.argv.length === 0) {
		return Promise.reject(new Error('spawn requires a non-empty argv array'))
	}

	const argv = options.argv.map((arg) =>
		typeof arg === 'string' ? arg : String(arg)
	)
	const env = cloneEnvRecord(childProcessState.env)
	if (options.env && typeof options.env === 'object') {
		for (const [key, value] of Object.entries(options.env)) {
			env[key] = value
		}
	}
	const cwd =
		typeof options.cwd === 'string' && options.cwd.length > 0
			? options.cwd
			: childProcessState.cwd

	const requestId = nextSpawnRequestId++

	return new Promise((resolve, reject) => {
		pendingSpawnRequests.set(requestId, { resolve, reject })

		try {
			controlPort.postMessage({
				type: CONTROL_MESSAGE_SPAWN_REQUEST,
				requestId,
				options: {
					argv,
					env,
					cwd,
					name: options.name,
					debug:
						typeof options.debug === 'boolean'
							? options.debug
							: childProcessState?.debug ?? false,
					stdio: options.stdio,
				},
			})
		} catch (error) {
			pendingSpawnRequests.delete(requestId)
			reject(
				error instanceof Error
					? error
					: new Error(String(error ?? 'Failed to request spawn'))
			)
		}
	})
}

export function initChildProcess(options: ChildProcessInitOptions) {
	const clonedOptions: ChildProcessInitOptions = {
		...options,
		argv: [...options.argv],
		env: { ...options.env },
	}

	stdioStreams?.stdin.destroy()
	stdioStreams?.stdout.destroy()
	stdioStreams?.stderr.destroy()

	stdioStreams = createChildStdio(clonedOptions.stdio)
	childProcessState = clonedOptions

	cleanupControlPort('reinitializing control channel')
	controlPort = options.controlPort
	if (!controlPort) {
		throw new Error('Missing control port from kernel payload')
	}
	controlPort.addEventListener('message', handleControlResponse)
	controlPort.start()

	const processController = {
		argv() {
			return [...childProcessState!.argv]
		},
		cwd() {
			return childProcessState!.cwd
		},
		chdir(path: string) {
			childProcessState!.cwd = path
		},
		getEnv(name: string) {
			return childProcessState!.env[name] ?? ''
		},
		setEnv(name: string, value: string) {
			childProcessState!.env[name] = value
		},
		getAllEnv() {
			return childProcessState!.env
		},
		pid() {
			return childProcessState!.pid
		},
		executablePath() {
			return childProcessState!.programPath
		},
		spawn(spawnOptions: ProcessControllerSpawnOptions) {
			return requestSpawnFromKernel(spawnOptions)
		},
		stdin: stdioStreams.stdin,
		stdout: stdioStreams.stdout,
		stderr: stdioStreams.stderr,
		exit(code: number) {
			cleanupControlPort('process exiting')
			stdioStreams?.stdout.end()
			stdioStreams?.stderr.end()
			self.postMessage({ type: 'exit', data: code })
			self.close()
		},
	}

	;(globalThis as any).processController = processController
}

export function installStdIo(isDebug: boolean) {
	if (!stdioStreams) {
		throw new Error('installStdIo called before initChildProcess')
	}

	const originalConsole = globalThis.console

	;(globalThis as any).__webPolyfillsOriginalConsole = originalConsole

	const joinArgs = (args: unknown[]) =>
		args
			.map((arg) => {
				const chunk = toKernelChunk(arg)
				return typeof chunk === 'string'
					? chunk
					: `[Uint8Array(${chunk.byteLength})]`
			})
			.join(' ')

	const writeStdout = (...args: unknown[]) => {
		if (isDebug) {
			originalConsole.log(...args)
		} else {
			const value = joinArgs(args)
			const chunk = appendTrailingNewlineIfText(toKernelChunk(value))
			stdioStreams!.stdout.write(chunk)
		}
	}

	const writeStderr = (...args: unknown[]) => {
		if (isDebug) {
			originalConsole.error(...args)
		} else {
			const value = joinArgs(args)
			const chunk = appendTrailingNewlineIfText(toKernelChunk(value))
			stdioStreams!.stderr.write(chunk)
		}
	}

	globalThis.console = {
		...originalConsole,
		log: writeStdout,
		info: writeStdout,
		debug: writeStdout,
		warn: writeStderr,
		error: writeStderr,
	}
}

const KERNEL_INIT_MESSAGE = '__kernel_internal__/initChildProcess'

const handleKernelInit = (event: MessageEvent) => {
	if (bootstrapComplete) {
		return
	}
	if (event.data?.type !== KERNEL_INIT_MESSAGE) {
		return
	}

	bootstrapComplete = true
	self.removeEventListener('message', handleKernelInit)

	const payload = event.data.payload as ChildProcessInitOptions
	initChildProcess(payload)
	installStdIo(payload.debug)
	queueMicrotask(() => startProgram(payload))
}

self.addEventListener('message', handleKernelInit)

const stripShebang = (source: string): string => {
	if (source.startsWith('#!')) {
		const newlineIndex = source.indexOf('\n')
		if (newlineIndex === -1) {
			return ''
		}
		return source.slice(newlineIndex + 1)
	}
	return source
}

const dirnameFromPath = (path: string): string => {
	if (!path || path === '/') {
		return '/'
	}
	const segments = path.split('/')
	segments.pop()
	const dir = segments.join('/')
	return dir.length > 0 ? dir : '/'
}

const reportProgramError = (error: unknown) => {
	try {
		const message =
			error instanceof Error
				? error.stack ?? error.message
				: String(error)
		stdioStreams?.stderr.write(
			message.endsWith('\n') ? message : message + '\n'
		)
	} catch (e) {
		originalConsole.error(e)
		// Ignore errors while reporting program error.
	}
	try {
		;(globalThis as any).processController.exit(1)
	} catch {
		// Ignore failures during forced exit.
	}
}

const executeProgram = async (options: ChildProcessInitOptions) => {
	if (!childProcessState || !stdioStreams) {
		throw new Error('executeProgram called before initialization')
	}

	const originalFilename = (globalThis as any).__filename
	const originalDirname = (globalThis as any).__dirname

	try {
		;(globalThis as any).__filename = options.programPath
		;(globalThis as any).__dirname = dirnameFromPath(options.programPath)

		const programBody = stripShebang(options.programSource)
		const globalEval = (eval as any) as (code: string) => unknown
		await globalEval(`"use strict";\n${programBody}`)
	} catch (error) {
		reportProgramError(error)
	} finally {
		if (typeof originalFilename === 'undefined') {
			delete (globalThis as any).__filename
		} else {
			;(globalThis as any).__filename = originalFilename
		}
		if (typeof originalDirname === 'undefined') {
			delete (globalThis as any).__dirname
		} else {
			;(globalThis as any).__dirname = originalDirname
		}
	}
}

const startProgram = (options: ChildProcessInitOptions) => {
	if (programStarted) {
		return
	}
	programStarted = true
	executeProgram(options)
}
