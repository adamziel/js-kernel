import { describe, it, expect, beforeEach } from 'vitest'
import { Kernel } from '../runtime/index.ts'
import { installCustomPrograms } from './programs/index.ts'

const decoder = new TextDecoder()

const toText = (chunk: string | Uint8Array) =>
	typeof chunk === 'string' ? chunk : decoder.decode(chunk)

describe('App node program', () => {
	let kernel: Kernel

	beforeEach(() => {
		kernel = new Kernel()
		kernel.mkdirSync('/bin', { recursive: true })
		kernel.setEnv('PATH', '/bin')
		installCustomPrograms(kernel)
	})

	it('executes a JavaScript file through node', async () => {
		kernel.writeFileSync(
			'/hello.js',
			`
				process.stdout.write('node program says hello\\n')
				process.exit(0)
			`,
			{ mode: 0o755 }
		)

		const subprocess = kernel.spawn({
			argv: ['node', '/hello.js'],
			env: {},
			cwd: '/',
			name: 'node-program',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		})

		expect(typeof subprocess).not.toBe('number')
		if (typeof subprocess === 'number') {
			throw new Error('failed to spawn node program')
		}

		let stdout = ''
		subprocess.stdout?.on('data', (chunk) => {
			stdout += toText(chunk)
		})

		let stderr = ''
		subprocess.stderr?.on('data', (chunk) => {
			stderr += toText(chunk)
		})

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0))
		})

		expect(exitCode).toBe(0)
		expect(stderr).toBe('')
		expect(stdout).toContain('node program says hello')
	})
})
