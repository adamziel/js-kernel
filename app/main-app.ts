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
kernel.writeFileSync('/bin/package.json', `{ "name": "my-package", "version": "1.0.0" }`, { mode: 0o755 })
kernel.mkdirSync('/node_modules/node-gyp/bin', { recursive: true })
kernel.writeFileSync('/node_modules/node-gyp/package.json', '{}', { mode: 0o755 })
kernel.writeFileSync('/node_modules/node-gyp/bin/node-gyp.js', '', { mode: 0o755 })

kernel.mkdirSync('/bin/node_modules/node-gyp/bin', { recursive: true })
kernel.writeFileSync('/bin/node_modules/node-gyp/package.json', '{}', { mode: 0o755 })
kernel.writeFileSync('/bin/node_modules/node-gyp/bin/node-gyp.js', '', { mode: 0o755 })

// kernel.writeFileSync(
// 	`/my-script.sh`,
// 	// `echo "Hello, world from a script!"`,
// 	// The pipe hangs once every couple page refreshes. @TODO: fix it.
// 	`
// 	echo "Hello, world from a script!" | cat > /my-file-haha.txt;
// 	ls /
// 	cat /my-file-haha.txt
	
// 	`,
// 	{ mode: 0o755 }
// )
// await runProgram(['sh', '/my-script.sh'])

// kernel.writeFileSync(
// 	`/hello-node.js`,
// 	`
// 	console.log('Hello from Node.js inside the kernel, here is the list of top-level files:');
// 	const fs = require('fs');
// 	console.log(fs.readdirSync('/'));
//  process.exit(0);
// 	`,
// 	{ mode: 0o755 }
// )
// await runProgram(['node', '/hello-node.js'])

// Install npm
const npmCodeResponse = await fetch('/programs/node-loader/npm/npm-single.js')
const npmCode = await npmCodeResponse.text()
kernel.writeFileSync('/bin/npm', npmCode, { mode: 0o755 })

const defaultInputResponse = await fetch('/programs/node-loader/npm/default-input.js')
const defaultInputCode = await defaultInputResponse.text()
kernel.writeFileSync('/bin/default-input.js', defaultInputCode, { mode: 0o755 })

// await runProgram(['node', '/bin/npm'])
await runProgram(['node', '/bin/npm', 'install', 'pnpm'])
await runProgram(['node', '/bin/node_modules/pnpm/bin/pnpm.cjs', 'install', 'cowsay'])

function runProgram(argv: string[]) {
	const worker = kernel.spawn({
		argv,
		env: {},
		cwd: '/bin',
		name: argv[0],
		// debug: true,
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
