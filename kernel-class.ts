import { InMemoryFileSystem } from './mixins/in-memory-fs.ts'
import { joinPaths } from './paths-utils.ts'

function applyMixins(derivedCtor: any, baseCtors: any[]) {
	for (const baseCtor of baseCtors) {
		for (const name of Object.getOwnPropertyNames(baseCtor.prototype)) {
			if (name === 'constructor') continue
			const descriptor = Object.getOwnPropertyDescriptor(
				baseCtor.prototype,
				name
			)
			if (descriptor) {
				Object.defineProperty(derivedCtor.prototype, name, descriptor)
			}
		}
	}
}

export type StdioMode = 'inherit' | 'ignore' | 'pipe'

export interface SpawnStdioOptions {
	stdin?: StdioMode
	stdout?: StdioMode
	stderr?: StdioMode
}

interface SpawnOptions {
	argv: string[]
	env: Record<string, string>
	cwd: string
	name: string
	debug?: boolean
	stdio?: SpawnStdioOptions
	parentPid?: number
}

export const enum ExitCode {
	OK = 0,
	ERROR = 1,
	NOT_FOUND = 127,
}

type Listener<Arg> = (input: Arg) => void

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

export type KernelStdioChunk = string | Uint8Array

interface KernelReadableEvents {
	data: KernelStdioChunk
	end: void
	close: void
}

interface KernelWritableEvents {
	close: void
}

export class KernelReadableStream extends BasicEventEmitter<KernelReadableEvents> {
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

	constructor(private readonly port: MessagePort) {
		super()
		port.addEventListener('message', this.handleMessage)
		port.start()
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.port.removeEventListener('message', this.handleMessage)
		this.port.close()
		this.emit('close', undefined as unknown as void)
		this.clearAll()
	}

	destroy() {
		this.close()
	}
}

export class KernelWritableStream extends BasicEventEmitter<KernelWritableEvents> {
	private closed = false

	constructor(private readonly port: MessagePort) {
		super()
		port.start()
	}

	write(chunk: KernelStdioChunk) {
		if (this.closed) return false
		try {
			this.port.postMessage({ type: 'data', payload: chunk })
			return true
		} catch {
			this.close()
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
		this.port.close()
		this.emit('close', undefined as unknown as void)
		this.clearAll()
	}

	private signalAndClose(type: 'end' | 'close') {
		try {
			this.port.postMessage({ type })
		} finally {
			this.destroy()
		}
	}
}

interface KernelStdioDescriptor {
	fd: 0 | 1 | 2
	mode: StdioMode
	port?: MessagePort
}

type ExitListener = (code: number) => void

const CONTROL_MESSAGE_SPAWN_REQUEST = '__kernel_internal__/spawnRequest'
const CONTROL_MESSAGE_SPAWN_RESULT = '__kernel_internal__/spawnResult'
const CONTROL_MESSAGE_KILL_REQUEST = '__kernel_internal__/killRequest'
const CONTROL_MESSAGE_KILL_RESULT = '__kernel_internal__/killResult'

interface KernelSubprocessExtras {
	pid: number
	stdin?: KernelWritableStream
	stdout?: KernelReadableStream
	stderr?: KernelReadableStream
	onExit(listener: ExitListener): void
	offExit(listener: ExitListener): void
	kill(): void
	exitCode: number | null
}

export type KernelSubprocess = Worker & KernelSubprocessExtras

class Kernel {
	private env: Record<string, string> = {
		PATH: '/bin',
	}

	private pidCounter = 1
	private readonly processes = new Map<
		number,
		{
			subprocess: KernelSubprocess
			parentPid: number | null
			children: Set<number>
		}
	>()
	private readonly textDecoder = new TextDecoder()

	constructor() {
		const fs = new InMemoryFileSystem()
		Object.assign(this, fs)
	}

	private get fs(): InMemoryFileSystem {
		return this as any
	}

	setEnv(key: string, value: string) {
		this.env[key] = value
	}

	getEnv(key: string) {
		return this.env[key] || ''
	}

	resolveExecutable(name: string) {
		const paths = this.getEnv('PATH').split(':')
		for (const path of paths) {
			const executable = joinPaths(path, name)
			if (this.fs.existsSync(executable)) {
				return executable
			}
		}
		return null
	}

	spawn(options: SpawnOptions): KernelSubprocess | ExitCode {
		const executablePath = this.resolveExecutable(options.argv[0])
		if (!executablePath) {
			return ExitCode.NOT_FOUND
		}

		const programSource = this.fs.readFileSync(executablePath, 'utf8')

		let worker: Worker
		try {
			worker = new Worker(
				new URL('./child-process-library.ts', import.meta.url),
				{
					type: 'module',
				}
			)
		} catch (e) {
			console.error(e)
			return ExitCode.ERROR
		}

		const pid = this.pidCounter++
		const parentPid = options.parentPid ?? null
		const stdioModes: [StdioMode, StdioMode, StdioMode] = [
			options.stdio?.stdin ?? 'inherit',
			options.stdio?.stdout ?? 'inherit',
			options.stdio?.stderr ?? 'inherit',
		]

		const transferList: MessagePort[] = []
		const childDescriptors: KernelStdioDescriptor[] = []
		const controlChannel = new MessageChannel()
		transferList.push(controlChannel.port1)
		const controlPort = controlChannel.port2

		let parentStdin: KernelWritableStream | undefined
		let parentStdout: KernelReadableStream | undefined
		let parentStderr: KernelReadableStream | undefined

		stdioModes.forEach((mode, fdIndex) => {
			const fd = fdIndex as 0 | 1 | 2
			if (mode === 'ignore') {
				childDescriptors.push({ fd, mode })
				return
			}

			const channel = new MessageChannel()
			childDescriptors.push({
				fd,
				mode,
				port: channel.port1,
			})
			transferList.push(channel.port1)

			if (mode === 'pipe') {
				if (fd === 0) {
					parentStdin = new KernelWritableStream(channel.port2)
				} else if (fd === 1) {
					parentStdout = new KernelReadableStream(channel.port2)
				} else {
					parentStderr = new KernelReadableStream(channel.port2)
				}
			} else {
				this.attachInheritedStream(
					fd,
					channel.port2,
					options.name,
					pid
				)
			}
		})

		const respondOnControlPort = (message: unknown) => {
			try {
				controlPort.postMessage(message)
			} catch {
				// Ignore failures when the child process has already exited.
			}
		}

		const handleControlMessage = (event: MessageEvent) => {
			const payload = event.data
			if (!payload || typeof payload !== 'object') {
				return
			}

			if (payload.type === CONTROL_MESSAGE_SPAWN_REQUEST) {
				const requestId = payload.requestId
				const childOptions = payload.options
				if (
					typeof requestId !== 'number' ||
					!childOptions ||
					!Array.isArray(childOptions.argv)
				) {
					respondOnControlPort({
						type: CONTROL_MESSAGE_SPAWN_RESULT,
						requestId,
						error: { code: ExitCode.ERROR },
					})
					return
				}

				const normalizedEnv: Record<string, string> = {}
				if (childOptions.env && typeof childOptions.env === 'object') {
					for (const [key, value] of Object.entries(childOptions.env)) {
						if (typeof value === 'string') {
							normalizedEnv[key] = value
						} else if (value != null) {
							normalizedEnv[key] = String(value)
						}
					}
				}

				const spawnResult = this.spawn({
					argv: childOptions.argv.map((arg: unknown) =>
						typeof arg === 'string' ? arg : String(arg)
					),
					env: normalizedEnv,
					cwd:
						typeof childOptions.cwd === 'string'
							? childOptions.cwd
							: '/',
					name:
						typeof childOptions.name === 'string'
							? childOptions.name
							: `${options.name ?? 'process'}:${pid}`,
					debug: Boolean(childOptions.debug ?? options.debug),
					stdio: childOptions.stdio,
					parentPid: pid,
				})

				if (typeof spawnResult === 'number') {
					respondOnControlPort({
						type: CONTROL_MESSAGE_SPAWN_RESULT,
						requestId,
						error: { code: spawnResult },
					})
				} else {
					respondOnControlPort({
						type: CONTROL_MESSAGE_SPAWN_RESULT,
						requestId,
						result: { pid: spawnResult.pid },
					})
				}
			} else if (payload.type === CONTROL_MESSAGE_KILL_REQUEST) {
				const requestId = payload.requestId
				const targetPid = payload.pid
				const success =
					typeof targetPid === 'number' ? this.kill(targetPid) : false

				if (typeof requestId === 'number') {
					respondOnControlPort({
						type: CONTROL_MESSAGE_KILL_RESULT,
						requestId,
						success,
					})
				}
			}
		}

		controlPort.addEventListener('message', handleControlMessage)
		controlPort.start()

		let exitCode: number | null = null
		let exited = false
		const exitListeners = new Set<ExitListener>()

		const cleanup = (code: number) => {
			if (exited) {
				return
			}
			exited = true
			exitCode = code
			parentStdin?.destroy()
			parentStdout?.destroy()
			parentStderr?.destroy()
			this.releaseProcessResources(pid, controlPort, handleControlMessage)
			for (const listener of Array.from(exitListeners)) {
				listener(code)
			}
			exitListeners.clear()
		}

		const handleMessage = (event: MessageEvent) => {
			const payload = event.data
			if (payload && typeof payload === 'object') {
				if (payload.type === 'exit') {
					worker.removeEventListener('message', handleMessage)
					worker.removeEventListener('error', handleError)
					const code =
						typeof payload.data === 'number'
							? payload.data
							: ExitCode.ERROR
					cleanup(code)
				}
			}
		}

		const handleError = () => {
			worker.removeEventListener('message', handleMessage)
			worker.removeEventListener('error', handleError)
			cleanup(ExitCode.ERROR)
		}

		worker.addEventListener('message', handleMessage)
		worker.addEventListener('error', handleError)

		const subprocess = Object.assign(worker, {
			pid,
			stdin: parentStdin,
			stdout: parentStdout,
			stderr: parentStderr,
			onExit: (listener: ExitListener) => {
				exitListeners.add(listener)
			},
			offExit: (listener: ExitListener) => {
				exitListeners.delete(listener)
			},
			kill: () => {
				worker.terminate()
				handleError()
			},
			get exitCode() {
				return exitCode
			},
		}) as KernelSubprocess

		this.processes.set(pid, {
			subprocess,
			parentPid,
			children: new Set<number>(),
		})

		if (parentPid !== null) {
			const parentEntry = this.processes.get(parentPid)
			parentEntry?.children.add(pid)
		}

		const initMessage = {
			type: '__kernel_internal__/initChildProcess',
			payload: {
				pid,
				argv: [...options.argv],
				env: { ...options.env },
				cwd: options.cwd,
				debug: Boolean(options.debug),
				stdio: childDescriptors,
				programPath: executablePath,
				programSource,
				controlPort: controlChannel.port1,
			},
		}

		worker.postMessage(initMessage, transferList)

		return subprocess
	}

	getProcess(pid: number) {
		const entry = this.processes.get(pid)
		return entry ? entry.subprocess : null
	}

	listProcesses() {
		return Array.from(this.processes.values(), (entry) => entry.subprocess)
	}

	kill(pid: number) {
		const entry = this.processes.get(pid)
		if (!entry) {
			return false
		}
		entry.subprocess.kill()
		return true
	}

	private attachInheritedStream(
		fd: 0 | 1 | 2,
		port: MessagePort,
		processName: string,
		pid: number
	) {
		if (fd === 0) {
			try {
				port.postMessage({ type: 'end' })
			} catch {
				// Ignore fail to notify child of stdin end.
			} finally {
				port.close()
			}
			return
		}

		const logger = fd === 1 ? console.log : console.error
		const prefix = processName
			? `[${processName}:${pid}]`
			: `[pid ${pid}]`

		const handleMessage = (event: MessageEvent) => {
			const payload = event.data
			if (!payload || typeof payload !== 'object') {
				return
			}
			if (payload.type === 'data') {
				const raw = payload.payload as KernelStdioChunk
				const text =
					typeof raw === 'string'
						? raw
						: this.textDecoder.decode(raw)
				logger(`${prefix} ${text}`)
			} else if (payload.type === 'end' || payload.type === 'close') {
				port.removeEventListener('message', handleMessage)
				port.close()
			}
		}

		port.addEventListener('message', handleMessage)
		port.start()
	}

	private releaseProcessResources(
		pid: number,
		controlPort: MessagePort,
		controlMessageHandler: (event: MessageEvent) => void
	) {
		controlPort.removeEventListener('message', controlMessageHandler)
		try {
			controlPort.close()
		} catch {
			// Ignore failures when closing an already-closed port.
		}

		const entry = this.processes.get(pid)
		if (!entry) {
			return
		}

		this.processes.delete(pid)

		if (entry.parentPid !== null) {
			const parentEntry = this.processes.get(entry.parentPid)
			parentEntry?.children.delete(pid)
		}

		const childPids = Array.from(entry.children)
		entry.children.clear()

		for (const childPid of childPids) {
			this.kill(childPid)
		}
	}
}

interface Kernel extends InMemoryFileSystem {}

applyMixins(Kernel, [InMemoryFileSystem])

export const KernelClass = Kernel as typeof Kernel & {
	prototype: typeof Kernel.prototype & InMemoryFileSystem
}
