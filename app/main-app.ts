import { installBusybox } from '../runtime/busybox/index.ts'
import { installCustomPrograms } from './programs/index.ts'
import { Kernel } from '../runtime/index.ts'

const kernel = new Kernel()
installBusybox(kernel)
installCustomPrograms(kernel)

kernel.writeFileSync(
	`/my-script.sh`,
	`echo "Hello, world from a script!"`,
	// The pipe hangs once every couple page refreshes. @TODO: fix it.
	// `echo "Hello, world from a script!" | cat`,
	{ mode: 0o755 }
)
await runProgram(['sh', '/my-script.sh'])

kernel.writeFileSync(`/my-script.php`, `<?php echo "Hello from PHP!"; ?>`, {
	mode: 0o755,
})
await runProgram(['php', '/my-script.php'])

function runProgram(argv: string[]) {
	const worker = kernel.spawn({
		argv,
		env: {},
		cwd: '/',
		name: 'shell',
		debug: true,
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