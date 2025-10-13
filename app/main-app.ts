import { installBusybox } from '../runtime/busybox/index.ts'
import { Kernel } from '../runtime/index.ts'

const kernel = new Kernel()
installBusybox(kernel);

kernel.writeFileSync(
	`/my-script.sh`,
	`
echo "Hello, world from a script!" | cat > yo.sh

	`,
	{ mode: 0o755 }
)

function mockShell(argv: string[]) {
	const worker = kernel.spawn({
		argv,
		env: {},
		cwd: '/',
		name: 'shell',
		// debug: true,
	})
	console.log('worker', worker)

	return new Promise((resolve) => {
		worker.onExit((code) => {
			// console.log('ls exited with code', code)
			resolve(code)
		})
	})
}

await mockShell(['sh', '/my-script.sh'])

// kernel.writeFileSync(
// 	`/bin/hello`,
// 	`
// console.log('Hello, world!');
// processController.fsSync.readdir('/');
// console.log('Hello, world 2!');
// try {
// 	const result = processController.spawnSync({
// 		argv: ['hello-child'],
// 		// debug: true,
// 	});
// 	console.log('Result:', result);
// } catch (error) {
// 	console.error('Error:', error);
// }
// console.log('Hello, world after!');

// `,
// 	{ mode: 0o755 }
// )

// kernel.writeFileSync(
// 	`/bin/hello-child`,
// 	`
// console.log('Hello from the child!');
// processController.exit(0);
// `,
// 	{ mode: 0o755 }
// )

// await mockShell(['mkdir', '/test']);
// await mockShell(['touch', '/test/file.txt']);
// await mockShell(['ls', '/test']);
// await mockShell(['mv', '/test', '/test2']);
// await mockShell(['ls', '/test2']);
// await mockShell(['rm', '-R', '/test2']);
// await mockShell(['ls', '/']);

// const lsWorker = kernel.spawn({
// 	argv: ['ls', '/'],
// 	env: {},
// 	cwd: '/',
// 	name: 'ls-demo',
// 	stdio: {
// 		stdout: 'pipe',
// 		stderr: 'pipe',
// 	},
// 	debug: false,
// })

// if (typeof lsWorker === 'number') {
// 	console.error(
// 		'Failed to spawn ls process',
// 		lsWorker === ExitCode.NOT_FOUND ? 'not found' : 'error'
// 	)
// } else {
// 	const decodeChunk = (chunk: KernelStdioChunk) =>
// 		typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)

// 	lsWorker.stdout?.on('data', (chunk) => {
// 		console.log('[ls stdout]', decodeChunk(chunk))
// 	})
// 	lsWorker.stderr?.on('data', (chunk) => {
// 		console.error('[ls stderr]', decodeChunk(chunk))
// 	})
// 	lsWorker.onExit((code) => {
// 		console.log('ls exited with code', code)
// 	})
// }
