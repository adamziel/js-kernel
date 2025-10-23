import { describe, it, expect, beforeEach } from 'vitest'
import { Kernel } from './kernel.ts'
import { installCustomPrograms } from '../../app/programs/index.ts'

const chunkToString = (chunk: string | Uint8Array) =>
	typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)

describe('Node program', () => {
	let kernel: Kernel

	beforeEach(() => {
		kernel = new Kernel()
		kernel.mkdirSync('/bin', { recursive: true })
		kernel.setEnv('PATH', '/bin')
		installCustomPrograms(kernel)
	})

	it('allows overriding loader URL via env', async () => {
		const loaderModuleSource = `
			export async function loadNode() {
				return {
					async runMain() {
						processController.stdout.write('node runtime output\\n')
						processController.exit(0)
					}
				}
			}
		`
		const loaderUrl =
			'data:text/javascript;charset=utf-8,' +
			encodeURIComponent(loaderModuleSource)

		const subprocess = kernel.spawn({
			argv: ['node'],
			env: { NODE_LOADER_URL: loaderUrl },
			cwd: '/',
			name: 'node-test',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		})

		expect(typeof subprocess).not.toBe('number')
		if (typeof subprocess === 'number') {
			throw new Error('spawn failed')
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
		expect(stdout).toContain('node runtime output')
	})
})
