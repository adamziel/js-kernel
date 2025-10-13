import { InMemoryFileSystem } from './mixins/in-memory-fs.ts'
import { joinPaths } from './paths-utils.ts'
import {
	BasicEventEmitter,
	KernelStdioChunk,
	MessagePortReadableStream,
	MessagePortWritableStream,
} from './message-port-streams.ts'
import { createProcessWorker } from './process-worker-factory.ts'
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
} from './process-constants.ts'
import {
	normalizeSpawnOptions,
	type NormalizedSpawnOptions,
	type SpawnStdioOptions,
	type StdioMode,
} from './spawn-options.ts'
import {
	serializeFsResponse,
	serializeFsError,
} from './fs-serialization.ts'

export type { StdioMode, SpawnStdioOptions } from './spawn-options.ts'

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

export interface SpawnOptions {
	argv: string[]
	env: Record<string, string>
	cwd: string
	name: string
	debug?: boolean
	stdio?: SpawnStdioOptions
}

export const enum ExitCode {
	OK = 0,
	ERROR = 1,
	NOT_FOUND = 127,
}

type ExitListener = (code: number) => void

interface PreparedStdioResource {
	fd: 0 | 1 | 2
	mode: StdioMode
	workerPort?: MessagePort
	hostPort?: MessagePort
}

interface PreparedSpawnResources {
	pid: number
	programPath: string
	programSource: string
	stdio: PreparedStdioResource[]
	control: {
		kernelPort: MessagePort
		processPort: MessagePort
	}
	fs: {
		kernelPort: MessagePort
		processPort: MessagePort
	}
	spawnSync: {
		kernelPort: MessagePort
		processPort: MessagePort
	}
}

interface KernelProcessRecord {
	pid: number
	parentPid: number | null
	name: string
	controlPort: MessagePort
	fsPort: MessagePort
	spawnSyncPort: MessagePort
	children: Set<number>
	hostType: 'kernel' | 'process'
	hostPid: number | null
	worker?: Worker
	exitCode: number | null
	exitListeners?: Set<ExitListener>
	stdio?: {
		stdin?: MessagePortWritableStream
		stdout?: MessagePortReadableStream
		stderr?: MessagePortReadableStream
	}
	controlCleanup: () => void
	fsCleanup: () => void
	spawnSyncCleanup: () => void
	setExitCode?: (code: number) => void
}

export interface KernelSubprocessExtras {
	pid: number
	stdin?: MessagePortWritableStream
	stdout?: MessagePortReadableStream
	stderr?: MessagePortReadableStream
	onExit(listener: ExitListener): void
	offExit(listener: ExitListener): void
	kill(): void
	readonly exitCode: number | null
}

export type KernelSubprocess = Worker & KernelSubprocessExtras

class Kernel {
	private env: Record<string, string> = {
		PATH: '/bin',
	}

	private pidCounter = 1
	private readonly processes = new Map<number, KernelProcessRecord>()
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

	private loadProgram(command: string) {
		const executablePath = this.resolveExecutable(command)
		if (!executablePath) {
			return null
		}
		const programSource = this.fs.readFileSync(executablePath, 'utf8')
		return { executablePath, programSource }
	}

	spawn(options: SpawnOptions): KernelSubprocess | ExitCode {
		const program = this.loadProgram(options.argv[0])
		if (!program) {
			return ExitCode.NOT_FOUND
		}

		const resources = this.prepareSpawnResources(
			options,
			program,
			null /* parentPid */
		)

		return this.createKernelHostedProcess(options, program, resources)
	}

	getProcess(pid: number) {
		const entry = this.processes.get(pid)
		return entry && entry.worker ? (entry.worker as KernelSubprocess) : null
	}

	listProcesses() {
		return Array.from(this.processes.values())
			.filter((record) => record.worker)
			.map((record) => record.worker as KernelSubprocess)
	}

	kill(pid: number) {
		const record = this.processes.get(pid)
		if (!record || record.exitCode !== null) {
			return false
		}

		if (record.hostType === 'kernel') {
			record.worker?.terminate()
			this.handleProcessExit(pid, ExitCode.ERROR)
			return true
		}

		const hostRecord =
			record.hostPid !== null
				? this.processes.get(record.hostPid)
				: null
		if (!hostRecord) {
			return false
		}

		try {
			hostRecord.controlPort.postMessage({
				type: CONTROL_MESSAGE_HOST_KILL_CHILD,
				pid,
			})
		} catch {
			return false
		}
		return true
	}

	private prepareSpawnResources(
		options: SpawnOptions,
		program: { executablePath: string; programSource: string },
		parentPid: number | null
	): PreparedSpawnResources {
		const pid = this.pidCounter++
		const stdioModes: [StdioMode, StdioMode, StdioMode] = [
			options.stdio?.stdin ?? 'inherit',
			options.stdio?.stdout ?? 'inherit',
			options.stdio?.stderr ?? 'inherit',
		]

		const stdio: PreparedStdioResource[] = []

		stdioModes.forEach((mode, fdIndex) => {
			const fd = fdIndex as 0 | 1 | 2
			if (mode === 'ignore') {
				stdio.push({ fd, mode })
				return
			}

			const channel = new MessageChannel()

			stdio.push({
				fd,
				mode,
				workerPort: channel.port1,
				hostPort: channel.port2,
			})
		})

		const controlChannel = new MessageChannel()
		const fsChannel = new MessageChannel()
		const spawnSyncChannel = new MessageChannel()

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
		}
	}

	private createKernelHostedProcess(
		options: SpawnOptions,
		program: { executablePath: string; programSource: string },
		resources: PreparedSpawnResources
	): KernelSubprocess {
		let parentStdin: MessagePortWritableStream | undefined
		let parentStdout: MessagePortReadableStream | undefined
		let parentStderr: MessagePortReadableStream | undefined

		const transferList: MessagePort[] = [
			resources.control.processPort,
			resources.fs.processPort,
			resources.spawnSync.processPort,
		]

		for (const descriptor of resources.stdio) {
			if (descriptor.workerPort) {
				transferList.push(descriptor.workerPort)
			}
			if (descriptor.mode === 'pipe' && descriptor.hostPort) {
				if (descriptor.fd === 0) {
					parentStdin = new MessagePortWritableStream(
						descriptor.hostPort
					)
				} else if (descriptor.fd === 1) {
					parentStdout = new MessagePortReadableStream(
						descriptor.hostPort
					)
				} else {
					parentStderr = new MessagePortReadableStream(
						descriptor.hostPort
					)
				}
			} else if (
				descriptor.mode === 'inherit' &&
				descriptor.hostPort
			) {
				this.attachInheritedStream(
					descriptor.fd,
					descriptor.hostPort,
					options.name,
					resources.pid
				)
			}
		}

		const worker = createProcessWorker()

		let exitCode: number | null = null
		const exitListeners = new Set<ExitListener>()

		const subprocess = Object.assign(worker, {
			pid: resources.pid,
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
				this.kill(resources.pid)
			},
			get exitCode() {
				return exitCode
			},
		}) as KernelSubprocess

		const record: KernelProcessRecord = {
			pid: resources.pid,
			parentPid: null,
			name: options.name,
			controlPort: resources.control.kernelPort,
			fsPort: resources.fs.kernelPort,
			spawnSyncPort: resources.spawnSync.kernelPort,
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
			controlCleanup: () => undefined,
			fsCleanup: () => undefined,
			spawnSyncCleanup: () => undefined,
			setExitCode: (code: number) => {
				exitCode = code
			},
		}

		this.processes.set(resources.pid, record)
		record.controlCleanup = this.installProcessControl(record)
		record.fsCleanup = this.installProcessFs(record)
		record.spawnSyncCleanup = this.installProcessSpawnSync(record)

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
		},
	}

		worker.postMessage(initMessage, transferList)

		return subprocess
	}

	private installProcessFs(record: KernelProcessRecord) {
		const handleFsMessage = async (event: MessageEvent) => {
			const payload = event.data
			if (!payload || typeof payload !== 'object') {
				return
			}
			if (payload.type !== CONTROL_MESSAGE_FS_REQUEST) {
				return
			}
			const requestId = payload.requestId
			const method = payload.method
			const args = payload.args
			if (
				typeof requestId !== 'number' ||
				typeof method !== 'string' ||
				!Array.isArray(args)
			) {
				return
			}
			let response
			try {
				const result = await this.invokeFsMethod(method, args)
				response = serializeFsResponse(result)
			} catch (error) {
				response = serializeFsError(error)
			}
			try {
				record.fsPort.postMessage({
					type: CONTROL_MESSAGE_FS_RESPONSE,
					requestId,
					response,
				})
			} catch {
				// Ignore failures sending responses on a closed port.
			}
		}

		record.fsPort.addEventListener('message', handleFsMessage)
		record.fsPort.start()

		return () => {
			record.fsPort.removeEventListener('message', handleFsMessage)
			try {
				record.fsPort.close()
			} catch {
				// Ignore failures closing an already closed port.
			}
		}
	}

	private installProcessSpawnSync(record: KernelProcessRecord) {
		const handleSpawnSyncMessage = (event: MessageEvent) => {
			const payload = event.data
			if (!payload || typeof payload !== 'object') {
				return
			}
			if (payload.type !== CONTROL_MESSAGE_SPAWN_SYNC_REQUEST) {
				return
			}
			const requestId = payload.requestId
			const options = payload.options
			if (typeof requestId !== 'number') {
				return
			}
			this.handleSpawnSyncRequest(record, requestId, options)
		}

		record.spawnSyncPort.addEventListener(
			'message',
			handleSpawnSyncMessage
		)
		record.spawnSyncPort.start()

		return () => {
			record.spawnSyncPort.removeEventListener(
				'message',
				handleSpawnSyncMessage
			)
			try {
				record.spawnSyncPort.close()
			} catch {
				// ignore
			}
		}
	}

	private async invokeFsMethod(
		method: string,
		args: unknown[]
	): Promise<unknown> {
		const fsInstance: Record<string, unknown> = this.fs as any
		const target = fsInstance[method]
		if (typeof target !== 'function') {
			throw new Error(`Unsupported filesystem method '${method}'`)
		}
		const result = target.apply(this.fs, args)
		if (result instanceof Promise) {
			return await result
		}
		return result
	}

	private handleSpawnSyncRequest(
		parentRecord: KernelProcessRecord,
		requestId: number,
		rawOptions: unknown
	) {
		const sendResponse = (response: {
			ok: boolean
			result?: {
				status: number | null
				stdout?: string
				stderr?: string
				error?: string
			}
			error?: { message: string }
		}) => {
			try {
				parentRecord.spawnSyncPort.postMessage({
					type: CONTROL_MESSAGE_SPAWN_SYNC_RESPONSE,
					requestId,
					response,
				})
			} catch {
				// ignore
			}
		}

		const options = rawOptions as NormalizedSpawnOptions | undefined
		if (
			!options ||
			!Array.isArray(options.argv) ||
			options.argv.length === 0
		) {
			sendResponse({
				ok: false,
				error: { message: 'Invalid spawn options' },
			})
			return
		}

		this.runSpawnSyncProcess(parentRecord, options)
			.then((result) => {
				sendResponse({ ok: true, result })
			})
			.catch((error) => {
				const message =
					error instanceof Error
						? error.message
						: String(error ?? 'spawnSync failed')
				sendResponse({ ok: false, error: { message } })
			})
	}

	private async runSpawnSyncProcess(
		parentRecord: KernelProcessRecord,
		options: NormalizedSpawnOptions
	): Promise<{
		status: number | null
		stdout?: string
		stderr?: string
		error?: string
	}> {
		const program = this.loadProgram(options.argv[0])
		if (!program) {
			throw new Error(`Command not found: ${options.argv[0]}`)
		}

		const stdio: SpawnStdioOptions = {
			stdin: options.stdio?.stdin ?? 'ignore',
			stdout: options.stdio?.stdout ?? 'pipe',
			stderr: options.stdio?.stderr ?? 'pipe',
		}

		const adjustedOptions: NormalizedSpawnOptions = {
			...options,
			stdio,
		}

		const resources = this.prepareSpawnResources(
			adjustedOptions,
			program,
			parentRecord.pid
		)

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
		}

		this.processes.set(resources.pid, record)
		parentRecord.children.add(resources.pid)
		record.controlCleanup = this.installProcessControl(record)
		record.fsCleanup = this.installProcessFs(record)
		record.spawnSyncCleanup = this.installProcessSpawnSync(record)

		const transferList: MessagePort[] = [
			resources.control.processPort,
			resources.fs.processPort,
			resources.spawnSync.processPort,
		]

		const textDecoder = new TextDecoder()
		const stdoutChunks: string[] = []
		const stderrChunks: string[] = []

		let stdoutStream: MessagePortReadableStream | null = null
		let stderrStream: MessagePortReadableStream | null = null

		for (const descriptor of resources.stdio) {
			if (descriptor.workerPort) {
				transferList.push(descriptor.workerPort)
			}
			if (descriptor.mode === 'pipe' && descriptor.hostPort) {
				if (descriptor.fd === 1) {
					const stream = new MessagePortReadableStream(
						descriptor.hostPort
					)
					stream.on('data', (chunk) => {
						const text =
							typeof chunk === 'string'
								? chunk
								: textDecoder.decode(chunk)
						stdoutChunks.push(text)
					})
					stdoutStream = stream
				} else if (descriptor.fd === 2) {
					const stream = new MessagePortReadableStream(
						descriptor.hostPort
					)
					stream.on('data', (chunk) => {
						const text =
							typeof chunk === 'string'
								? chunk
								: textDecoder.decode(chunk)
						stderrChunks.push(text)
					})
					stderrStream = stream
				} else {
					descriptor.hostPort.close()
				}
			} else if (descriptor.hostPort) {
				descriptor.hostPort.close()
			}
		}

		const worker = createProcessWorker()
		record.worker = worker

		record.setExitCode = (code: number) => {
			finalize(code)
		}

		let resultResolve: (value: {
			status: number | null
			stdout?: string
			stderr?: string
			error?: string
		}) => void
		const resultPromise = new Promise<{
			status: number | null
			stdout?: string
			stderr?: string
			error?: string
		}>((resolve) => {
			resultResolve = resolve
		})

		let resolved = false

		const finalize = (
			status: number | null,
			error?: string
		): void => {
			if (resolved) {
				return
			}
			resolved = true
			stdoutStream?.destroy()
			stderrStream?.destroy()
			resultResolve({
				status,
				stdout:
					stdoutChunks.length > 0 ? stdoutChunks.join('') : undefined,
				stderr:
					stderrChunks.length > 0 ? stderrChunks.join('') : undefined,
				error,
			})
		}

		worker.addEventListener('message', (event: MessageEvent) => {
			const payload = event.data
			if (
				payload &&
				typeof payload === 'object' &&
				payload.type === 'exit'
			) {
				const code =
					typeof payload.data === 'number' ? payload.data : null
				finalize(code)
			}
		})

		worker.addEventListener('error', () => {
			finalize(null, 'Process worker crashed')
			this.handleProcessExit(resources.pid, ExitCode.ERROR)
		})

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
		}

		try {
			worker.postMessage(initMessage, transferList)
		} catch (error) {
			finalize(
				null,
				error instanceof Error
					? error.message
					: String(error ?? 'Failed to initialize process')
			)
			this.handleProcessExit(resources.pid, ExitCode.ERROR)
			return resultPromise
		}

		return resultPromise
	}

	private installProcessControl(record: KernelProcessRecord) {
		const handleControlMessage = (event: MessageEvent) => {
			const payload = event.data
			if (!payload || typeof payload !== 'object') {
				return
			}

			if (payload.type === CONTROL_MESSAGE_SPAWN_REQUEST) {
				this.handleSpawnRequestFromProcess(
					record,
					payload.requestId,
					payload.options
				)
			} else if (payload.type === CONTROL_MESSAGE_KILL_REQUEST) {
				const targetPid = payload.pid
				const requestId = payload.requestId
				const success =
					typeof targetPid === 'number'
						? this.kill(targetPid)
						: false
				try {
					record.controlPort.postMessage({
						type: CONTROL_MESSAGE_KILL_RESULT,
						requestId,
						success,
					})
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
				)
			} else if (
				payload.type === CONTROL_MESSAGE_REPORT_CHILD_EXIT &&
				typeof payload.pid === 'number'
			) {
				this.handleProcessExit(
					payload.pid,
					typeof payload.code === 'number'
						? payload.code
						: ExitCode.ERROR
				)
			}
		}

		record.controlPort.addEventListener(
			'message',
			handleControlMessage
		)
		record.controlPort.start()

		return () => {
			record.controlPort.removeEventListener(
				'message',
				handleControlMessage
			)
			try {
				record.controlPort.close()
			} catch {
				// Ignore failures closing an already closed port.
			}
		}
	}

	private handleSpawnRequestFromProcess(
		parentRecord: KernelProcessRecord,
		requestId: unknown,
		rawOptions: unknown
	) {
		if (typeof requestId !== 'number') {
			return
		}

		const options = normalizeSpawnOptions(rawOptions)
		if (!options) {
			this.sendSpawnFailure(parentRecord.controlPort, requestId)
			return
		}

		const program = this.loadProgram(options.argv[0])
		if (!program) {
			this.sendSpawnFailure(
				parentRecord.controlPort,
				requestId,
				ExitCode.NOT_FOUND
			)
			return
		}

		const resources = this.prepareSpawnResources(
			options,
			program,
			parentRecord.pid
		)

		const record: KernelProcessRecord = {
			pid: resources.pid,
			parentPid: parentRecord.pid,
			name: options.name,
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
		}

		this.processes.set(resources.pid, record)
		parentRecord.children.add(resources.pid)
		record.controlCleanup = this.installProcessControl(record)
		record.fsCleanup = this.installProcessFs(record)
		record.spawnSyncCleanup = this.installProcessSpawnSync(record)

		const response = {
			type: CONTROL_MESSAGE_SPAWN_RESULT,
			requestId,
			result: {
				pid: resources.pid,
				programPath: resources.programPath,
				programSource: resources.programSource,
				stdio: resources.stdio.map((descriptor) => ({
					fd: descriptor.fd,
					mode: descriptor.mode,
					workerPort: descriptor.workerPort ?? null,
					parentPort:
						descriptor.mode === 'pipe'
							? descriptor.hostPort ?? null
							: null,
				})),
				controlPort: resources.control.processPort,
				fsPort: resources.fs.processPort,
				spawnSyncPort: resources.spawnSync.processPort,
			},
		}

		const transferList: MessagePort[] = [
			resources.control.processPort,
			resources.fs.processPort,
			resources.spawnSync.processPort,
		]
		for (const descriptor of resources.stdio) {
			if (descriptor.workerPort) {
				transferList.push(descriptor.workerPort)
			}
			if (descriptor.mode === 'pipe' && descriptor.hostPort) {
				transferList.push(descriptor.hostPort)
			} else if (
				descriptor.mode === 'inherit' &&
				descriptor.hostPort
			) {
				// Child output should still reach the kernel console.
				this.attachInheritedStream(
					descriptor.fd,
					descriptor.hostPort,
					options.name,
					resources.pid
				)
			}
		}

		try {
			parentRecord.controlPort.postMessage(
				response,
				transferList
			)
		} catch {
			// If the parent can no longer receive messages, tear down the child.
			this.handleProcessExit(resources.pid, ExitCode.ERROR)
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
			})
		} catch {
			// Ignore failures caused by a closed port.
		}
	}

	private handleProcessExit(pid: number, code: number) {
	const record = this.processes.get(pid)
	if (!record || record.exitCode !== null) {
		return
	}

	record.exitCode = code
	record.setExitCode?.(code)

	record.controlCleanup()
	record.fsCleanup()
	record.spawnSyncCleanup()

		this.processes.delete(pid)

		if (record.parentPid !== null) {
			const parentRecord = this.processes.get(record.parentPid)
			parentRecord?.children.delete(pid)
			if (parentRecord) {
				try {
					parentRecord.controlPort.postMessage({
						type: CONTROL_MESSAGE_CHILD_EXIT,
						pid,
						code,
					})
				} catch {
					// Ignore failures dispatching child exit notifications.
				}
			}
		}

		const childPids = Array.from(record.children)
		for (const childPid of childPids) {
			this.kill(childPid)
		}

		if (record.hostType === 'kernel') {
			record.stdio?.stdin?.destroy()
			record.stdio?.stdout?.destroy()
			record.stdio?.stderr?.destroy()

			if (record.exitListeners) {
				for (const listener of Array.from(record.exitListeners)) {
					try {
						listener(code)
					} catch {
						// Ignore listener failures to avoid disrupting cleanup.
					}
				}
				record.exitListeners.clear()
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
				port.postMessage({ type: 'end' })
			} catch {
				// Ignore failures notifying stdin closure.
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
}

interface Kernel extends InMemoryFileSystem {}

applyMixins(Kernel, [InMemoryFileSystem])

export const KernelClass = Kernel as typeof Kernel & {
	prototype: typeof Kernel.prototype & InMemoryFileSystem
}
