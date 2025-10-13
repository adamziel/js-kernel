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

interface ChildProcessInitOptions {
	argv: string[];
	env: Record<string, string>;
	cwd: string;
	debug: boolean;
}

let childProcessState: ChildProcessInitOptions | null = null

export function initChildProcess(options: ChildProcessInitOptions) {
	childProcessState = options
}

export function installStdIo(isDebug: boolean) {
	const originalConsole = globalThis.console
	;(globalThis as any).__webPolyfillsOriginalConsole = originalConsole

	const joinArgs = (args: unknown[]) =>
		args
			.map((arg) => (typeof arg === 'string' ? arg : String(arg)))
			.join(' ')

	const writeStdout = (text: string) => {
		(globalThis as any).processController.stdout.write(text.endsWith('\n') ? text : text + '\n')
	}

	const writeStderr = (text: string) => {
		(globalThis as any).processController.stderr.write(text.endsWith('\n') ? text : text + '\n')
	}

	globalThis.console = {
		...originalConsole,
		log: (...args: unknown[]) => {
			if (isDebug && typeof originalConsole?.log === 'function') {
				originalConsole.log(...args as any)
			}
			writeStdout(joinArgs(args))
		},
		info: (...args: unknown[]) => {
			if (isDebug && typeof originalConsole?.info === 'function') {
				originalConsole.info(...args as any)
			}
			writeStdout(joinArgs(args))
		},
		debug: (...args: unknown[]) => {
			if (isDebug && typeof originalConsole?.debug === 'function') {
				originalConsole.debug(...args as any)
			}
			writeStdout(joinArgs(args))
		},
		warn: (...args: unknown[]) => {
			if (isDebug && typeof originalConsole?.warn === 'function') {
				originalConsole.warn(...args as any)
			}
			writeStderr(joinArgs(args))
		},
		error: (...args: unknown[]) => {
			if (isDebug && typeof originalConsole?.error === 'function') {
				originalConsole.error(...args as any)
			}
			writeStderr(joinArgs(args))
		},
	}
}

globalThis.processController = {
	argv() {
		return [...(childProcessState?.argv ?? [])]
	},
	cwd() {
		return childProcessState?.cwd ?? ''
	},
	chdir(path: string) {
		childProcessState!.cwd = path
	},
	getEnv(name: string) {
		return childProcessState?.env[name] ?? ''
	},
	setEnv(name: string, value: string) {
		childProcessState!.env[name] = value
	},
	getAllEnv() {
		return childProcessState?.env ?? {}
	},
	stdout: {
		write: (message: string) => {
			self.postMessage({ type: 'stdout', data: message })
		},
	},
	stderr: {
		write: (message: string) => {
			self.postMessage({ type: 'stderr', data: message })
		},
	},
	exit: (code: number) => {
		self.postMessage({ type: 'exit', data: code })
		self.close()
	},
}
