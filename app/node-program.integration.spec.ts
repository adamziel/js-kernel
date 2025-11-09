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
			const text = toText(chunk)
			console.log('[node-read-file] stdout chunk:', text)
			stdout += text
		})

		let stderr = ''
		subprocess.stderr?.on('data', (chunk) => {
			const text = toText(chunk)
			console.log('[node-read-file] stderr chunk:', text)
			stderr += text
		})

		const exitCode = await new Promise<number>((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined
			const cleanup = () => {
				if (timeoutId !== undefined) {
					clearTimeout(timeoutId)
				}
			}
			timeoutId = setTimeout(() => {
				console.log('[node-read-file] timeout stdout:', stdout)
				console.log('[node-read-file] timeout stderr:', stderr)
				reject(new Error('node-read-file timeout'))
			}, 8000)
			subprocess.onExit((code) => {
				cleanup()
				resolve(code ?? 0)
			})
		})

		expect(exitCode).toBe(0)
		expect(stderr).toBe('')
		expect(stdout).toContain('node program says hello')
	})

	it(
		'can read files from the kernel filesystem via fs.readFileSync',
		async () => {
			kernel.mkdirSync('/project', { recursive: true })
			kernel.writeFileSync('/project/hello.txt', 'Hello from kernel FS\\n')

			kernel.writeFileSync(
				'/project/read-file.js',
				`
					const fs = require('fs');
					try {
						const data = fs.readFileSync('./hello.txt', 'utf8');
						process.stdout.write(data.trim());
						process.exit(0);
					} catch (error) {
						const message = error && error.stack ? error.stack : String(error);
						process.stderr.write(message);
						process.exit(1);
					}
				`,
				{ mode: 0o755 }
			)

			const subprocess = kernel.spawn({
				argv: ['node', '/project/read-file.js'],
				env: {},
				cwd: '/project',
				name: 'node-read-file',
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

			const exitCode = await new Promise<number>((resolve, reject) => {
				const timeoutId = setTimeout(() => {
					try {
						subprocess.kill?.()
					} catch {}
					reject(new Error('node-read-file timeout'))
				}, 8000)
				subprocess.onExit((code) => {
					clearTimeout(timeoutId)
					resolve(code ?? 0)
				})
			})

			if (exitCode !== 0) {
				console.log('[node-read-file] stderr output', stderr)
			}
			expect(exitCode).toBe(0)
			expect(stderr).toBe('')
			expect(stdout).toContain('Hello from kernel FS')
	},
	15000
	)
})
