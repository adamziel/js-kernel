import { describe, it, expect, beforeEach } from 'vitest'
import { Kernel } from './kernel.ts'

const decoder = new TextDecoder()

const chunkToString = (chunk: string | Uint8Array) =>
	typeof chunk === 'string' ? chunk : decoder.decode(chunk)

describe('processController filesystem access', () => {
	let kernel: Kernel

	beforeEach(() => {
		kernel = new Kernel()
		kernel.mkdirSync('/bin', { recursive: true })
		kernel.setEnv('PATH', '/bin')
	})

	it('supports async fs operations via processController.fs', async () => {
		const programSource = `
			export default async function main(processController) {
				await processController.fs.writeFile('/async-output.txt', 'from async fs', {
					encoding: 'utf8',
				});
				const content = await processController.fs.readFile('/async-output.txt', 'utf8');
				processController.stdout.write(content);
				processController.exit(0);
			}
		`
		kernel.writeFileSync('/bin/fs-write-async', programSource, {
			mode: 0o755,
		})

		const subprocess = kernel.spawn({
			argv: ['fs-write-async'],
			env: {},
			cwd: '/',
			name: 'fs-async',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		})

		expect(typeof subprocess).not.toBe('number')
		if (typeof subprocess === 'number') {
			throw new Error('spawn returned exit code')
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
		expect(stdout).toContain('from async fs')
		expect(kernel.readFileSync('/async-output.txt', 'utf8')).toBe('from async fs')
	})

	it('supports sync fs operations via processController.fsSync', async () => {
		const programSource = `
			export default async function main(processController) {
				processController.fsSync.writeFileSync('/sync-output.txt', 'from sync fs', 'utf8');
				const content = processController.fsSync.readFileSync('/sync-output.txt', 'utf8');
				processController.stdout.write(content);
				processController.exit(0);
			}
		`
		kernel.writeFileSync('/bin/fs-write-sync', programSource, {
			mode: 0o755,
		})

		const subprocess = kernel.spawn({
			argv: ['fs-write-sync'],
			env: {},
			cwd: '/',
			name: 'fs-sync',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		})

		expect(typeof subprocess).not.toBe('number')
		if (typeof subprocess === 'number') {
			throw new Error('spawn returned exit code')
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
		expect(stdout).toContain('from sync fs')
		expect(kernel.readFileSync('/sync-output.txt', 'utf8')).toBe('from sync fs')
	})
})
