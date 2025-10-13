import {
	BasicEventEmitter,
	KernelStdioChunk,
	MessagePortReadableStream,
	MessagePortWritableStream,
} from './message-port-streams.ts'
import {
	CONTROL_MESSAGE_CHILD_EXIT,
	CONTROL_MESSAGE_HOST_KILL_CHILD,
	CONTROL_MESSAGE_KILL_REQUEST,
	CONTROL_MESSAGE_KILL_RESULT,
	CONTROL_MESSAGE_PROCESS_EXIT,
	CONTROL_MESSAGE_REPORT_CHILD_EXIT,
	CONTROL_MESSAGE_SPAWN_REQUEST,
	CONTROL_MESSAGE_SPAWN_RESULT,
} from './process-constants.ts'
import { createProcessWorker } from './process-worker-factory.ts'
import {
	normalizeSpawnOptions,
	type NormalizedSpawnOptions,
	type StdioMode,
} from './spawn-options.ts'

export type { StdioMode } from './spawn-options.ts'

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

interface SpawnPlanMessage {
	pid: number
	programPath: string
	programSource: string
	stdio: Array<{
		fd: 0 | 1 | 2
		mode: StdioMode
		workerPort: MessagePort | null
		parentPort: MessagePort | null
	}>
	controlPort: MessagePort
}

type ExitListener = (code: number) => void

interface ChildProcessHandle {
	pid: number
	stdin?: MessagePortWritableStream
	stdout?: MessagePortReadableStream
	stderr?: MessagePortReadableStream
	onExit(listener: ExitListener): void
	offExit(listener: ExitListener): void
	kill(): void
	readonly exitCode: number | null
}

interface PendingSpawnRequest {
	options: NormalizedSpawnOptions
	resolve: (handle: ChildProcessHandle) => void
	reject: (error: Error) => void
}

interface LocalChildProcessRecord {
	handle: ChildProcessHandle
	worker: Worker
	exitListeners: Set<ExitListener>
	setExitCode: (code: number) => void
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
const pendingSpawnRequests = new Map<number, PendingSpawnRequest>()
const localChildProcesses = new Map<number, LocalChildProcessRecord>()

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
				new Error(`Spawn failed with exit code ${payload.error.code}`)
			)
			return
		}

		const result = payload.result as SpawnPlanMessage | undefined
		if (!result) {
			pending.reject(new Error('Spawn result missing payload'))
			return
		}

		try {
			const handle = createChildProcessHandle(result, pending.options)
			pending.resolve(handle)
		} catch (error) {
			pending.reject(
				error instanceof Error
					? error
					: new Error(
							String(error ?? 'Failed to create child process')
					  )
			)
		}
	} else if (payload.type === CONTROL_MESSAGE_KILL_RESULT) {
		// Kill acknowledgements are handled implicitly by exit notifications.
	} else if (payload.type === CONTROL_MESSAGE_CHILD_EXIT) {
		const pid = payload.pid
		if (typeof pid !== 'number') {
			return
		}
		const record = localChildProcesses.get(pid)
		if (!record) {
			return
		}
		const code =
			typeof payload.code === 'number'
				? payload.code
				: record.handle.exitCode ?? 0
		record.setExitCode(code)
		localChildProcesses.delete(pid)
	} else if (payload.type === CONTROL_MESSAGE_HOST_KILL_CHILD) {
		const pid = payload.pid
		if (typeof pid !== 'number') {
			return
		}
		const record = localChildProcesses.get(pid)
		if (!record) {
			return
		}
		record.worker.terminate()
		record.setExitCode(1)
		localChildProcesses.delete(pid)
		reportChildExitToKernel(pid, 1)
	}
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
			const normalized = normalizeSpawnOptions(spawnOptions, {
				env: childProcessState?.env,
				cwd: childProcessState?.cwd,
				debug: childProcessState?.debug,
			})
			if (!normalized) {
				throw new Error('Invalid spawn options')
			}
			return requestSpawnFromKernel(normalized)
		},
		stdin: stdioStreams.stdin,
		stdout: stdioStreams.stdout,
		stderr: stdioStreams.stderr,
		exit(code: number) {
			if (controlPort) {
				try {
					controlPort.postMessage({
						type: CONTROL_MESSAGE_PROCESS_EXIT,
						pid: childProcessState?.pid ?? 0,
						code,
					})
				} catch {
					// Ignore failures when notifying kernel about exit.
				}
			}

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
	const message =
		error instanceof Error ? error.stack ?? error.message : String(error)
	try {
		stdioStreams?.stderr.write(
			message.endsWith('\n') ? message : message + '\n'
		)
	} catch {
		// Ignore errors while reporting program error.
	}
	try {
		;(globalThis as any).processController.exit(1)
	} catch {
		// Ignore failures during forced exit.
	}
}

const executeProgram = (options: ChildProcessInitOptions) => {
	if (!childProcessState || !stdioStreams) {
		throw new Error('executeProgram called before initialization')
	}

	const originalFilename = (globalThis as any).__filename
	const originalDirname = (globalThis as any).__dirname

	try {
		;(globalThis as any).__filename = options.programPath
		;(globalThis as any).__dirname = dirnameFromPath(options.programPath)

		const programBody = stripShebang(options.programSource)
		const globalEval = (0, eval) as (code: string) => unknown
		globalEval(`"use strict";\n${programBody}`)
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

function requestSpawnFromKernel(
	options: NormalizedSpawnOptions
): Promise<ChildProcessHandle> {
	if (!controlPort || !childProcessState) {
		return Promise.reject(
			new Error('processController.spawn is not available')
		)
	}

	const requestId = nextSpawnRequestId++

	return new Promise<ChildProcessHandle>((resolve, reject) => {
		pendingSpawnRequests.set(requestId, { options, resolve, reject })

		try {
			controlPort.postMessage({
				type: CONTROL_MESSAGE_SPAWN_REQUEST,
				requestId,
				options,
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

function createChildProcessHandle(
	plan: SpawnPlanMessage,
	options: NormalizedSpawnOptions
): ChildProcessHandle {
	const transferList: MessagePort[] = [plan.controlPort]
	let parentStdin: MessagePortWritableStream | undefined
	let parentStdout: MessagePortReadableStream | undefined
	let parentStderr: MessagePortReadableStream | undefined

	for (const descriptor of plan.stdio) {
		if (descriptor.workerPort) {
			transferList.push(descriptor.workerPort)
		}
		if (
			descriptor.mode === 'pipe' &&
			descriptor.parentPort &&
			descriptor.fd === 0
		) {
			parentStdin = new MessagePortWritableStream(descriptor.parentPort)
		} else if (
			descriptor.mode === 'pipe' &&
			descriptor.parentPort &&
			descriptor.fd === 1
		) {
			parentStdout = new MessagePortReadableStream(descriptor.parentPort)
		} else if (
			descriptor.mode === 'pipe' &&
			descriptor.parentPort &&
			descriptor.fd === 2
		) {
			parentStderr = new MessagePortReadableStream(descriptor.parentPort)
		}
	}

	const worker = createProcessWorker()

	const exitListeners = new Set<ExitListener>()
	let exitCode: number | null = null

	const handle: ChildProcessHandle = {
		pid: plan.pid,
		stdin: parentStdin,
		stdout: parentStdout,
		stderr: parentStderr,
		onExit(listener: ExitListener) {
			exitListeners.add(listener)
		},
		offExit(listener: ExitListener) {
			exitListeners.delete(listener)
		},
		kill() {
			if (!controlPort) {
				return
			}
			try {
				controlPort.postMessage({
					type: CONTROL_MESSAGE_KILL_REQUEST,
					pid: plan.pid,
					requestId: null,
				})
			} catch {
				// Ignore failures dispatching kill request.
			}
		},
		get exitCode() {
			return exitCode
		},
	}

	const setExitCode = (code: number) => {
		if (exitCode !== null) {
			return
		}
		exitCode = code
		try {
			parentStdin?.destroy()
		} catch {
			// Ignore stream cleanup errors.
		}
		try {
			parentStdout?.destroy()
		} catch {
			// Ignore stream cleanup errors.
		}
		try {
			parentStderr?.destroy()
		} catch {
			// Ignore stream cleanup errors.
		}
		for (const listener of Array.from(exitListeners)) {
			try {
				listener(code)
			} catch {
				// Ignore listener failures.
			}
		}
		exitListeners.clear()
	}

	localChildProcesses.set(plan.pid, {
		handle,
		worker,
		exitListeners,
		setExitCode,
	})

	worker.addEventListener('message', (event: MessageEvent) => {
		const payload = event.data
		if (payload && typeof payload === 'object' && payload.type === 'exit') {
			const code =
				typeof payload.data === 'number' ? payload.data : exitCode ?? 0
			setExitCode(code)
		}
	})

	worker.addEventListener('error', () => {
		setExitCode(1)
		reportChildExitToKernel(plan.pid, 1)
	})

	const initMessage = {
		type: '__kernel_internal__/initChildProcess',
		payload: {
			pid: plan.pid,
			argv: [...options.argv],
			env: { ...options.env },
			cwd: options.cwd,
			debug: Boolean(options.debug),
			stdio: plan.stdio.map((descriptor) => ({
				fd: descriptor.fd,
				mode: descriptor.mode,
				port: descriptor.workerPort ?? undefined,
			})),
			programPath: plan.programPath,
			programSource: plan.programSource,
			controlPort: plan.controlPort,
		},
	}

	worker.postMessage(initMessage, transferList)

	return handle
}

function reportChildExitToKernel(pid: number, code: number) {
	if (!controlPort) {
		return
	}
	try {
		controlPort.postMessage({
			type: CONTROL_MESSAGE_REPORT_CHILD_EXIT,
			pid,
			code,
		})
	} catch {
		// Ignore failures when informing kernel about exit.
	}
}
