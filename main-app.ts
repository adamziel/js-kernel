import { ExitCode, KernelClass } from './kernel-class.ts'
import type { KernelStdioChunk } from './kernel-class.ts'

const kernel = new KernelClass()

kernel.mkdirSync('/bin', { mode: 0o755 })
kernel.writeFileSync('/bin/hello', `
console.log("Hello, world!");
console.error(new Error("Hello, error!"));
console.log(new Uint8Array([1, 2, 3]));

console.log(processController.fsSync.readdir('/'));

async function main() {
	console.log(await processController.fs.readdir('/'));
	const spawned = await processController.spawn({
		argv: ['hello-2'],
		stdio: {
			stdout: 'pipe',
			stderr: 'pipe',
		},
		// debug: true,
	});
	spawned.stdout?.on('data', (chunk) => {
		console.log('[nested child stdout]', chunk)
	})
	spawned.stderr?.on('data', (chunk) => {
		console.error('[nested child stderr]', chunk)
	})
	// console.log('Spawned process', Object.keys(spawned));
	// console.log({spawned});
	// await new Promise(resolve => setTimeout(resolve, 8000));
}
main();
`, {
	mode: 0o755,
})
kernel.writeFileSync('/bin/hello-2', `
console.log("Nested hello, world!");
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
	debug: true,
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
