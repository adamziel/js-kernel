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
	console.log(process)
	`,
	{ mode: 0o755 }
)
await runProgram(['node', '/hello-node.js'])

// Install npm
const npmCodeResponse = await fetch('/programs/node-loader/npm/npm-single.js')
const npmCode = await npmCodeResponse.text()
kernel.writeFileSync('/bin/npm', npmCode, { mode: 0o755 })

const defaultInputResponse = await fetch('/programs/node-loader/npm/default-input.js')
const defaultInputCode = await defaultInputResponse.text()
kernel.writeFileSync('/bin/default-input.js', defaultInputCode, { mode: 0o755 })

// This works fine
console.log(kernel.readFileSync('/bin/default-input.js', { encoding: 'utf-8' }).substring(0, 100))

kernel.writeFileSync(
	`/hello-node.js`,
	`
	console.log('Hello from Node.js inside the kernel');
	require('fs');
	// This starts later on in the file, a good chunk of the data is missing.
	console.log(fs.default.readFileSync('/bin/npm', { encoding: 'utf-8' }))
	// console.log(process)
	`,
	{ mode: 0o755 }
)
await runProgram(['node', '/hello-node.js'])

await runProgram(['node', '/bin/npm'])

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
