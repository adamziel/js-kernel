import { ExitCode, KernelClass } from './kernel-class'
import type { KernelStdioChunk } from './kernel-class'

const kernel = new KernelClass()

kernel.mkdirSync('/bin', { mode: 0o755 })
kernel.writeFileSync('/bin/hello', `
console.log("Hello, world!");
// console.error(new Error("Hello, error!"));
`, {
	mode: 0o755,
})

const helloWorker = kernel.spawn({
	argv: ['hello'],
	env: {},
	cwd: '/',
	name: 'hello',
	stdio: {
		stdout: 'pipe',
		stderr: 'pipe',
	},
})

if (typeof helloWorker === 'number') {
	console.error('Failed to spawn hello process', helloWorker === ExitCode.NOT_FOUND ? 'not found' : 'error')
} else {
	const decodeChunk = (chunk: KernelStdioChunk) =>
		typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)

	helloWorker.stdout?.on('data', (chunk) => {
		console.log('[child stdout]', decodeChunk(chunk))
	})
	helloWorker.stderr?.on('data', (chunk) => {
		console.error('[child stderr]', decodeChunk(chunk))
	})
	helloWorker.onExit((code) => {
		console.log('Child exited with code', code)
	})
}
