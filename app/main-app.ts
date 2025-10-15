import { installBusybox } from '../runtime/busybox/index.ts';
import { installCustomPrograms } from './programs/index.ts';
import { Kernel } from '../runtime/index.ts';

const kernel = new Kernel();
installBusybox(kernel);
installCustomPrograms(kernel);

kernel.mkdirSync('/home/user/.npm/_cacache', { recursive: true });
kernel.mkdirSync('/.npm', { recursive: true });
kernel.mkdirSync('/bin', { recursive: true });
kernel.mkdirSync('/tmp', { recursive: true });
if (!kernel.existsSync('/bin/node')) {
	kernel.writeFileSync('/bin/node', '', { mode: 0o755 });
}
kernel.writeFileSync(
	'/bin/package.json',
	`{ "name": "my-package", "version": "1.0.0" }`,
	{ mode: 0o755 }
);
kernel.mkdirSync('/node_modules/node-gyp/bin', { recursive: true });
kernel.writeFileSync('/node_modules/node-gyp/package.json', '{}', {
	mode: 0o755,
});
kernel.writeFileSync('/node_modules/node-gyp/bin/node-gyp.js', '', {
	mode: 0o755,
});

kernel.mkdirSync('/bin/node_modules/node-gyp/bin', { recursive: true });
kernel.writeFileSync('/bin/node_modules/node-gyp/package.json', '{}', {
	mode: 0o755,
});
kernel.writeFileSync('/bin/node_modules/node-gyp/bin/node-gyp.js', '', {
	mode: 0o755,
});

// Shell fun

const worker = await kernel.spawn({
	argv: ['tty-shell'],
	env: {},
	cwd: '/bin',
	name: 'tty-shell',
	stdio: {
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe',
	},
	debug: true,
});
console.log({ worker });
if (typeof worker === 'number') {
	throw new Error('Failed to spawn program');
}
self.addEventListener('message', (event) => {
	if (event.data.type === 'stdin') {
		console.log('input', event.data.data);
		worker.stdin!.write(event.data.data);
	} else if (event.data.type === 'runProgram') {
		runProgram(event.data.argv);
	}
});
worker.stdout!.on('data', (data) => {
	self.postMessage({ type: 'stdout', data: data });
});
worker.stderr!.on('data', (data) => {
	self.postMessage({ type: 'stderr', data: data });
});
worker.onExit((code) => {
	self.postMessage({ type: 'exit', data: code });
});

class TestCases {
	static async testWorker() {
		kernel.writeFileSync(
			'/script.js',
			`
			console.log('Hello from script');
			const { Worker } = require('worker_threads');
			const worker = new Worker('/worker.js');
			console.log('Hello 2 from script');
			worker.on('message', (message) => {
				console.log('message', message);
			});
			worker.on('error', (error) => {
				console.log('error', error);
			});
			setTimeout(() => {
				worker.postMessage('Message from the parent – after 100ms');
			}, 100);
			worker.postMessage('Message from the parent');
			setTimeout(() => {
				process.exit(0);
			}, 1000);
			`,
			{ mode: 0o755 }
		);
		kernel.writeFileSync(
			'/worker.js',
			`
			//require('fs').writeFileSync('/worker.txt', 'Hello from worker');
			console.log('Hello from worker');
			const { parentPort } = require('worker_threads');
			parentPort.on('message', (message) => {
				console.log('message', message);
			});
			// parentPort.postMessage('Message from the worker');
			console.log('Hello 2 from worker');
			setTimeout(() => {
				process.exit(0);
			}, 2000);
			`,
			{ mode: 0o755 }
		);

		await runProgram(['node', '/script.js']);
	}

	static async testPnpm() {
		const npmCodeResponse = await fetch(
			'/programs/node-loader/npm/npm-single.js'
		);
		const npmCode = await npmCodeResponse.text();
		kernel.writeFileSync('/bin/npm', npmCode, { mode: 0o755 });

		const defaultInputResponse = await fetch(
			'/programs/node-loader/npm/default-input.js'
		);
		const defaultInputCode = await defaultInputResponse.text();
		kernel.writeFileSync('/bin/default-input.js', defaultInputCode, {
			mode: 0o755,
		});

		await runProgram(['node', '/bin/npm', 'install', 'pnpm']);

		kernel.writeFileSync(
			`/my-script.sh`,
			`
		mkdir /pnpm-project;
		echo '{"name":"pnpm-project","version":"1.0.0","main":"index.js"}' > /pnpm-project/package.json;
		cd /pnpm-project;

		`,
			{ mode: 0o755 }
		);
		await runProgram(['sh', '/my-script.sh']);

		// @TODO: How do I know when the program is done with all the async stuff?
		// We need to delay this execution until it is.
		kernel.mkdirSync('/bin/node_modules/.ignored', { recursive: true });
		kernel.renameSync('/bin/node_modules/pnpm', '/bin/node_modules/.ignored/pnpm');
		// try {
		// 	await runProgram(
		// 		[
		// 			'node',
		// 			'/bin/node_modules/pnpm/bin/pnpm.cjs',
		// 			'install',
		// 			'cowsay',
		// 		],
		// 		'/pnpm-project'
		// 	);
		// } catch (error) {
		// 	console.error('Error installing pnpm', error);
		// }
		// Need to await ^ and then ron v to let pnpm self-move to .ignored
		await runProgram(
			[
				'node',
				'/bin/node_modules/.ignored/pnpm/bin/pnpm.cjs',
				'install',
				'cowsay',
			],
			'/pnpm-project'
		);
	}

	static async runBash() {
		kernel.writeFileSync(
			`/my-script.sh`,
			// `echo "Hello, world from a script!"`,
			// The pipe hangs once every couple page refreshes. @TODO: fix it.
			`
		echo "Hello, world from a script!" | cat > /my-file-haha.txt;
		ls /
		cat /my-file-haha.txt

		`,
			{ mode: 0o755 }
		);
		await runProgram(['sh', '/my-script.sh']);

		kernel.writeFileSync(
			`/hello-node.js`,
			`
		console.log('Hello from Node.js inside the kernel, here is the list of top-level files:');
		const fs = require('fs');
		console.log(fs.readdirSync('/'));
	process.exit(0);
		`,
			{ mode: 0o755 }
		);
		await runProgram(['node', '/hello-node.js']);
	}
}

await TestCases.testWorker();
// await TestCases.testPnpm();

function runProgram(argv: string[], cwd: string = '/bin') {
	const worker = kernel.spawn({
		argv,
		env: {},
		cwd,
		name: argv[0],
		debug: true,
	});
	if (typeof worker === 'number') {
		throw new Error('Failed to spawn program');
	}

	return new Promise((resolve) => {
		worker.onExit((code) => {
			resolve(code);
		});
	});
}
