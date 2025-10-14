import { installBusybox } from '../runtime/busybox/index.ts'
import { installCustomPrograms } from './programs/index.ts'
import { Kernel } from '../runtime/index.ts'

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

kernel.writeFileSync(
	`/my-script.sh`,
	`echo "Hello, world from a script!"`,
	// The pipe hangs once every couple page refreshes. @TODO: fix it.
	// `echo "Hello, world from a script!" | cat`,
	{ mode: 0o755 }
)
await runProgram(['sh', '/my-script.sh'])

// kernel.writeFileSync(`/my-script.php`, `<?php echo "Hello from PHP!"; ?>`, {
// 	mode: 0o755,
// })
// await runProgram(['php', '/my-script.php'])

kernel.writeFileSync(
	`/hello-node.js`,
	`
	console.log('Hello from Node.js inside the kernel');
	require('fs');
	console.log(fs.default.readdirSync('/'))
	`,
	{ mode: 0o755 }
)
await runProgram(['node', '/hello-node.js'])

function runProgram(argv: string[]) {
	const worker = kernel.spawn({
		argv,
		env: {},
		cwd: '/',
		name: argv[0],
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
