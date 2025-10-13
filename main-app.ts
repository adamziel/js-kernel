import { ExitCode, KernelClass } from './kernel-class.ts'
import type { KernelStdioChunk } from './kernel-class.ts'
import { busyboxPrograms } from './busybox-programs/index.ts'

const kernel = new KernelClass()

// Initiate busybox programs

kernel.mkdirSync('/bin', { mode: 0o755 })
for (const [name, source] of Object.entries(busyboxPrograms)) {
	kernel.writeFileSync(`/bin/${name}`, `${source}\n`, { mode: 0o755 })
}

const lsWorker = kernel.spawn({
	argv: ['ls', '/bin'],
	env: {},
	cwd: '/',
	name: 'ls-demo',
	stdio: {
		stdout: 'pipe',
		stderr: 'pipe',
	},
	debug: false,
})

if (typeof lsWorker === 'number') {
	console.error(
		'Failed to spawn ls process',
		lsWorker === ExitCode.NOT_FOUND ? 'not found' : 'error'
	)
} else {
	const decodeChunk = (chunk: KernelStdioChunk) =>
		typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)

	lsWorker.stdout?.on('data', (chunk) => {
		console.log('[ls stdout]', decodeChunk(chunk))
	})
	lsWorker.stderr?.on('data', (chunk) => {
		console.error('[ls stderr]', decodeChunk(chunk))
	})
	lsWorker.onExit((code) => {
		console.log('ls exited with code', code)
	})
}
