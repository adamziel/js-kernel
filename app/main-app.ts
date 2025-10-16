import { installBusybox } from '../runtime/busybox/index.ts'
import { installCustomPrograms } from './programs/index.ts'
import { Kernel, type KernelSubprocess } from '../runtime/index.ts'
import { joinPaths, normalizePath } from '../runtime/util/paths.ts'

const kernel = new Kernel()
installBusybox(kernel)
installCustomPrograms(kernel)

kernel.mkdirSync('/home/user/.npm/_cacache', { recursive: true })
kernel.mkdirSync('/.npm', { recursive: true })
kernel.mkdirSync('/bin', { recursive: true })
kernel.mkdirSync('/tmp', { recursive: true })
if (!kernel.existsSync('/bin/node')) {
	kernel.writeFileSync('/bin/node', '', { mode: 0o755 })
}
kernel.writeFileSync('/bin/package.json', `{ "name": "my-package", "version": "1.0.0" }`, { mode: 0o755 })
kernel.mkdirSync('/node_modules/node-gyp/bin', { recursive: true })
kernel.writeFileSync('/node_modules/node-gyp/package.json', '{}', { mode: 0o755 })
kernel.writeFileSync('/node_modules/node-gyp/bin/node-gyp.js', '', { mode: 0o755 })

kernel.mkdirSync('/bin/node_modules/node-gyp/bin', { recursive: true })
kernel.writeFileSync('/bin/node_modules/node-gyp/package.json', '{}', { mode: 0o755 })
kernel.writeFileSync('/bin/node_modules/node-gyp/bin/node-gyp.js', '', { mode: 0o755 })

// Shell fun

const textDecoder = new TextDecoder()
const COMMAND_MARKER = '\u0000'
const COMMAND_SCRIPT_PATH = '/tmp/.tty-shell-command.sh'
const HOME_DIRECTORY = '/home/user'
let shellCwd = '/bin'
let stderrBuffer = ''
let currentProcess: KernelSubprocess | null = null
let isTerminatingCurrentProcess = false

const decodeChunk = (chunk: unknown): string => {
        if (typeof chunk === 'string') {
                return chunk
        }
        if (chunk instanceof Uint8Array) {
                return textDecoder.decode(chunk)
        }
        if (chunk instanceof ArrayBuffer) {
                return textDecoder.decode(new Uint8Array(chunk))
        }
        return String(chunk ?? '')
}

const containsCtrlC = (chunk: unknown) => decodeChunk(chunk).includes('\u0003')

const postToTerminal = (type: 'stdout' | 'stderr', data: string) => {
        if (!data) return
        self.postMessage({ type, data })
}

const resolveShellPath = (target: string) =>
        normalizePath(target.startsWith('/') ? target : joinPaths(shellCwd, target))

const terminateCurrentProcess = () => {
        if (!currentProcess || isTerminatingCurrentProcess) {
                return
        }
        isTerminatingCurrentProcess = true
        try {
                currentProcess.kill()
        } catch {
                // Ignore failures when the process is already gone.
        }
}

const clearCurrentProcess = () => {
        currentProcess = null
        isTerminatingCurrentProcess = false
}

const handleCdCommand = (rawCommand: string): boolean => {
        if (!rawCommand.startsWith('cd')) {
                return false
        }
        const argument = rawCommand.slice(2).trim()
        const target = argument || HOME_DIRECTORY
        try {
                const resolved = resolveShellPath(target)
                if (!kernel.existsSync(resolved)) {
                        postToTerminal('stderr', `cd: no such file or directory: ${target}\n`)
                        return true
                }
                const stats = kernel.statSync(resolved)
                if (!stats.isDirectory()) {
                        postToTerminal('stderr', `cd: not a directory: ${target}\n`)
                        return true
                }
                shellCwd = resolved
        } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                postToTerminal('stderr', `cd: ${message}\n`)
        }
        return true
}

const runCommand = (rawCommand: string) => {
        const normalizedCommand = rawCommand.replace(/\r$/, '')
        const trimmed = normalizedCommand.trim()
        if (!trimmed) {
                return
        }
        if (handleCdCommand(trimmed)) {
                return
        }
        try {
                kernel.writeFileSync(COMMAND_SCRIPT_PATH, `${normalizedCommand}\n`, { mode: 0o755 })
        } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                postToTerminal('stderr', `tty-shell: failed to prepare command: ${message}\n`)
                return
        }
        const child = kernel.spawn({
                argv: ['sh', COMMAND_SCRIPT_PATH],
                env: {},
                cwd: shellCwd,
                name: 'sh',
                stdio: {
                        stdin: 'pipe',
                        stdout: 'pipe',
                        stderr: 'pipe',
                },
        })
        if (typeof child === 'number') {
                postToTerminal('stderr', `tty-shell: command not found: ${trimmed}\n`)
                return
        }
        currentProcess = child
        isTerminatingCurrentProcess = false
        child.stdout?.on('data', (chunk) => {
                postToTerminal('stdout', decodeChunk(chunk))
        })
        child.stderr?.on('data', (chunk) => {
                postToTerminal('stderr', decodeChunk(chunk))
        })
        child.onExit((code) => {
                clearCurrentProcess()
                self.postMessage({ type: 'commandExit', data: code })
        })
}

const handleShellStderr = (chunk: string) => {
        stderrBuffer += chunk
        while (true) {
                const markerIndex = stderrBuffer.indexOf(COMMAND_MARKER)
                if (markerIndex === -1) {
                        break
                }
                if (markerIndex > 0) {
                        postToTerminal('stderr', stderrBuffer.slice(0, markerIndex))
                        stderrBuffer = stderrBuffer.slice(markerIndex)
                }
                if (stderrBuffer.length === 1) {
                        return
                }
                const newlineIndex = stderrBuffer.indexOf('\n', 1)
                if (newlineIndex === -1) {
                        return
                }
                const command = stderrBuffer.slice(1, newlineIndex)
                stderrBuffer = stderrBuffer.slice(newlineIndex + 1)
                runCommand(command)
        }
        if (stderrBuffer && !stderrBuffer.startsWith(COMMAND_MARKER)) {
                postToTerminal('stderr', stderrBuffer)
                stderrBuffer = ''
        }
}

const shellProcess = await kernel.spawn({
        argv: ['tty-shell'],
        env: {},
        cwd: shellCwd,
        name: 'tty-shell',
        stdio: {
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe',
        },
        debug: true,
})

if (typeof shellProcess === 'number') {
        throw new Error('Failed to spawn tty-shell')
}

self.addEventListener('message', (event) => {
        if (event.data.type !== 'stdin') {
                return
        }
        const chunk = event.data.data
        const isCtrlC = containsCtrlC(chunk)
        if (currentProcess) {
                if (isCtrlC) {
                        terminateCurrentProcess()
                        shellProcess.stdin?.write(chunk)
                } else {
                        currentProcess.stdin?.write(chunk)
                }
                return
        }
        shellProcess.stdin?.write(chunk)
        if (isCtrlC) {
                terminateCurrentProcess()
        }
})

shellProcess.stdout?.on('data', (data) => {
        postToTerminal('stdout', decodeChunk(data))
})

shellProcess.stderr?.on('data', (data) => {
        handleShellStderr(decodeChunk(data))
})

shellProcess.onExit((code) => {
        self.postMessage({ type: 'exit', data: code })
})



// kernel.writeFileSync(
// 	`/my-script.sh`,
// 	// `echo "Hello, world from a script!"`,
// 	// The pipe hangs once every couple page refreshes. @TODO: fix it.
// 	`
// 	echo "Hello, world from a script!" | cat > /my-file-haha.txt;
// 	ls /
// 	cat /my-file-haha.txt
	
// 	`,
// 	{ mode: 0o755 }
// )
// await runProgram(['sh', '/my-script.sh'])

// kernel.writeFileSync(
// 	`/hello-node.js`,
// 	`
// 	console.log('Hello from Node.js inside the kernel, here is the list of top-level files:');
// 	const fs = require('fs');
// 	console.log(fs.readdirSync('/'));
//  process.exit(0);
// 	`,
// 	{ mode: 0o755 }
// )
// await runProgram(['node', '/hello-node.js'])

// Install npm
const npmCodeResponse = await fetch('/programs/node-loader/npm/npm-single.js')
const npmCode = await npmCodeResponse.text()
kernel.writeFileSync('/bin/npm', npmCode, { mode: 0o755 })

const defaultInputResponse = await fetch('/programs/node-loader/npm/default-input.js')
const defaultInputCode = await defaultInputResponse.text()
kernel.writeFileSync('/bin/default-input.js', defaultInputCode, { mode: 0o755 })

await runProgram(['node', '/bin/npm', 'install', 'pnpm'])
await runProgram(['node', '/bin/node_modules/pnpm/bin/pnpm.cjs', 'install', 'cowsay'])

function runProgram(argv: string[]) {
	const worker = kernel.spawn({
		argv,
		env: {},
		cwd: '/bin',
		name: argv[0],
		// debug: true,
	})
	if (typeof worker === 'number') {
		throw new Error('Failed to spawn program')
	}

	return new Promise((resolve) => {
		worker.onExit((code) => {
			resolve(code)
		})
	})
}
