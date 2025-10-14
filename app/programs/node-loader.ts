type KernelStdioChunk = string | Uint8Array

interface KernelReadableStream {
	on(event: 'data', listener: (chunk: KernelStdioChunk) => void): () => void
	on(event: 'end', listener: () => void): () => void
	on(event: 'close', listener: () => void): () => void
}

interface KernelWritableStream {
	write(chunk: KernelStdioChunk): boolean
	end(chunk?: KernelStdioChunk): boolean
	close(): boolean
	destroy(): void
}

interface KernelSpawnHandle {
	pid: number
	stdin?: KernelWritableStream
	stdout?: KernelReadableStream
	stderr?: KernelReadableStream
	onExit(listener: (code: number) => void): void
	offExit(listener: (code: number) => void): void
	kill(): void
	exitCode: number | null
}

interface KernelSpawnOptions {
	argv: string[]
	env: Record<string, string>
	cwd: string
	name: string
	debug?: boolean
	stdio?: {
		stdin?: 'pipe' | 'ignore' | 'inherit'
		stdout?: 'pipe' | 'ignore' | 'inherit'
		stderr?: 'pipe' | 'ignore' | 'inherit'
	}
}

interface ProcessControllerLike {
	spawn(options: KernelSpawnOptions): Promise<KernelSpawnHandle | number>
	argv(): string[]
	cwd?(): string
	getAllEnv?(): Record<string, string>
	getEnv?(name: string): string
	setEnv?(name: string, value: string): void
	exit?(code: number): void
}

export type NodeProcessExitInfo = {
	code: number
	signal: string | null
}

export type SpawnedNodeProcessHandle = {
	waitForExit(): Promise<NodeProcessExitInfo>
	write(data: string): void
	end(): void
	resize(cols: number, rows: number): void
	signal(signal?: string): void
	terminate(): void
}

export type SpawnNodeProcessOptions = {
	env?: Record<string, string>
	cwd?: string
	columns?: number
	rows?: number
	name?: string
	debug?: boolean
	onStdout?: (text: string) => void
	onStderr?: (text: string) => void
	onExit?: (info: NodeProcessExitInfo) => void
	onError?: (error: Error) => void
	onReady?: () => void
	onMessage?: (data: unknown) => void
}

interface NodeRuntime {
	runMain(): unknown
}

const clientBootUrl = new URL(
	'./node-loader/src/this-is-imported-directly/client-boot.js',
	import.meta.url
).href

let runtimePromise: Promise<NodeRuntime> | null = null
let spawnProcessInitialized = false

export async function loadNode(): Promise<NodeRuntime> {
	if (!runtimePromise) {
		runtimePromise = bootstrapNodeRuntime()
	}
	return runtimePromise
}

async function bootstrapNodeRuntime(): Promise<NodeRuntime> {
	const controller = (
		globalThis as { processController?: ProcessControllerLike }
	).processController

	if (!controller) {
		throw new Error(
			'processController is not available for Node runtime bootstrap'
		)
	}

	ensureSpawnNodeProcess(controller)

	let module;
	try {
		module = await import(/* @vite-ignore */ clientBootUrl.slice(0, 4) + clientBootUrl.slice(4))
	} catch (error) {
		console.error(error);
		console.trace('Error loading client-boot.js:', error)
		throw error
	}
	if (typeof module.runMain !== 'function') {
		throw new Error('client-boot.js did not export runMain')
	}

	return {
		runMain() {
			return Promise.resolve(module.runMain())
		},
	}
}

function ensureSpawnNodeProcess(controller: ProcessControllerLike) {
	if (spawnProcessInitialized) {
		return
	}
	if (typeof (globalThis as { spawnNodeProcess?: unknown }).spawnNodeProcess !== 'function') {
		;(globalThis as { spawnNodeProcess: unknown }).spawnNodeProcess =
			createSpawnNodeProcess(controller)
	}
	spawnProcessInitialized = true
}

function createSpawnNodeProcess(controller: ProcessControllerLike) {
	let counter = 0
	const decoder = new TextDecoder()

	return async function spawnNodeProcess(
		options: SpawnNodeProcessOptions = {}
	): Promise<SpawnedNodeProcessHandle> {
		try {
			const argv = sanitizeArgv(options?.argvInput)
			if (argv.length === 0) {
				throw new Error(
					'spawnNodeProcess: argv must be a non-empty array of strings'
				)
			}

			const env = {
				...(typeof controller.getAllEnv === 'function'
					? { ...controller.getAllEnv() }
					: {}),
				...sanitizeEnv(options.env),
			}

			const cwd =
				typeof options.cwd === 'string' && options.cwd.length
					? options.cwd
					: typeof controller.cwd === 'function'
					? controller.cwd()
					: '/'

			const name =
				typeof options.name === 'string' && options.name.length
					? options.name
					: `node-process-${++counter}`

			const spawnResult = await controller.spawn({
				argv,
				env,
				cwd,
				name,
				debug: Boolean(options.debug),
				stdio: {
					stdin: 'pipe',
					stdout: 'pipe',
					stderr: 'pipe',
				},
			})

			if (typeof spawnResult === 'number') {
				throw new Error(
					`spawnNodeProcess: child exited before start (code ${spawnResult})`
				)
			}

			const handle = spawnResult as KernelSpawnHandle

			let resolveExit!: (info: NodeProcessExitInfo) => void
			const exitInfo: NodeProcessExitInfo = { code: 0, signal: null }
			const exitPromise = new Promise<NodeProcessExitInfo>((resolve) => {
				resolveExit = resolve
			})

			const detachments: Array<() => void> = []
			const normalizeChunk = (chunk: KernelStdioChunk) =>
				typeof chunk === 'string' ? chunk : decoder.decode(chunk)

			if (handle.stdout && typeof options.onStdout === 'function') {
				const detach = handle.stdout.on('data', (chunk) => {
					options.onStdout?.(normalizeChunk(chunk))
				})
				if (typeof detach === 'function') {
					detachments.push(detach)
				}
			}

			if (handle.stderr && typeof options.onStderr === 'function') {
				const detach = handle.stderr.on('data', (chunk) => {
					options.onStderr?.(normalizeChunk(chunk))
				})
				if (typeof detach === 'function') {
					detachments.push(detach)
				}
			}

			const exitListener = (code: number) => {
				exitInfo.code = Number.isInteger(code) ? code : 0
				options.onExit?.(exitInfo)
				resolveExit(exitInfo)
				try {
					handle.offExit(exitListener)
				} catch {
					// ignore cleanup failures
				}
				for (const detach of detachments) {
					try {
						detach()
					} catch {
						// ignore cleanup failures
					}
				}
			}

			handle.onExit(exitListener)

			options.onReady?.()

			return {
				waitForExit: () => exitPromise,
				write(data: string) {
					if (!handle.stdin) {
						return
					}
					handle.stdin.write(data)
				},
				end() {
					handle.stdin?.end()
				},
				resize(_cols: number, _rows: number) {
					// Terminal resizing is not yet supported in the kernel runtime.
				},
				signal(_signal?: string) {
					handle.kill()
				},
				terminate() {
					handle.kill()
				},
			}
		} catch (error) {
			const normalised =
				error instanceof Error ? error : new Error(String(error))
			options.onError?.(normalised)
			throw normalised
		}
	}
}

function sanitizeArgv(input: unknown): string[] {
	if (!Array.isArray(input)) {
		return []
	}
	return input.map((value) =>
		value == null ? '' : typeof value === 'string' ? value : String(value)
	)
}

function sanitizeEnv(input: Record<string, unknown> | undefined) {
	const result: Record<string, string> = {}
	if (!input) {
		return result
	}
	for (const [key, value] of Object.entries(input)) {
		if (typeof key !== 'string' || key.length === 0) {
			continue
		}
		result[key] = value == null ? '' : String(value)
	}
	return result
}
