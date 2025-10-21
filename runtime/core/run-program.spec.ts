import { describe, it, expect, beforeEach } from 'vitest'
import { Kernel } from './kernel.ts'
import { installBusybox } from '../busybox/index.ts'

const textDecoder = new TextDecoder()
const utilsModuleUrl = new URL('../busybox/lib/utils.ts', import.meta.url).href

const chunkToString = (chunk: string | Uint8Array) =>
	typeof chunk === 'string' ? chunk : textDecoder.decode(chunk)

describe('Kernel programs', () => {
	let kernel: Kernel

	const programPath = '/bin/direct-stdout'

	beforeEach(() => {
		kernel = new Kernel()
		installBusybox(kernel)
		kernel.mkdirSync('/bin', { recursive: true })
		kernel.setEnv('PATH', '/bin')
		kernel.writeFileSync(
			programPath,
			`
				export default async function main(processController) {
					const { writeStdout } = await import(/* @vite-ignore */ ${JSON.stringify(utilsModuleUrl)});
					writeStdout('direct output');
					return 0;
				}
			`,
			{ mode: 0o755 }
		)
		const echoSource = kernel.readFileSync('/bin/echo', 'utf8')
		expect(echoSource.length).toBeGreaterThan(0)
	})

	it('echo writes arguments to stdout', async () => {
		const subprocess = kernel.spawn({
			argv: ['direct-stdout'],
			env: {},
			cwd: '/',
			name: 'stdout-test',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		})

		expect(typeof subprocess).not.toBe('number')
		if (typeof subprocess === 'number') {
			throw new Error('spawn returned error code')
		}

		expect(subprocess.stdout).toBeDefined()
		let stdout = ''
		const stdoutClosed = new Promise<void>((resolve) => {
			subprocess.stdout?.on('close', () => resolve())
		})

		const stdoutEvents: Array<string | Uint8Array> = []
		subprocess.stdout?.on('data', (chunk) => {
			stdoutEvents.push(chunk)
			stdout += chunkToString(chunk)
		})

		let stderr = ''
		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk)
		})

		const exitCodePromise = new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0))
		})
		const exitCode = await exitCodePromise
		await stdoutClosed

		expect(exitCode).toBe(0)
		expect(stderr).toBe('')
		expect(stdout).toBe('direct output\n')
		expect(stdoutEvents.length).toBeGreaterThan(0)
	})

	it('busybox echo writes to stdout', async () => {
		const subprocess = kernel.spawn({
			argv: ['echo', 'hello world'],
			env: {},
			cwd: '/',
			name: 'echo-test',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		})

		expect(typeof subprocess).not.toBe('number')
		if (typeof subprocess === 'number') {
			throw new Error('spawn returned error code')
		}

		let stdout = ''
		subprocess.stdout?.on('data', (chunk) => {
			stdout += chunkToString(chunk)
		})

		let stderr = ''
		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk)
		})

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0))
		})

		expect(exitCode).toBe(0)
		expect(stderr).toBe('')
		expect(stdout).toBe('hello world\n')
	})
})
