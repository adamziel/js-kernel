import { installBusybox } from '../runtime/busybox/index.ts';
import { installCustomPrograms } from './programs/index.ts';
import { Kernel } from '../runtime/index.ts';
import { BlobReader, ZipReader, Uint8ArrayWriter } from "@zip.js/zip.js";

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

function ensureParentDirectory(targetPath: string) {
	const lastSlash = targetPath.lastIndexOf('/');
	if (lastSlash <= 0) {
		return;
	}
	const directory = targetPath.slice(0, lastSlash);
	kernel.mkdirSync(directory, { recursive: true });
}

async function unzip(zipData: Uint8Array): Promise<Record<string, Uint8Array>> {
	// Convert Uint8Array to Blob - create a new ArrayBuffer copy to ensure proper type
	const arrayBuffer = zipData.slice().buffer as ArrayBuffer;
	const zipBlob = new Blob([arrayBuffer]);
	
	// Create a BlobReader to read the zip file
	const zipFileReader = new BlobReader(zipBlob);
	
	// Create a ZipReader to read the zip content
	const zipReader = new ZipReader(zipFileReader);
	
	// Get all entries from the zip file
	const entries = await zipReader.getEntries();
	
	// Extract all entries into an object
	const result: Record<string, Uint8Array> = {};
	
	for (const entry of entries) {
		// Skip if it's a directory (directories end with /)
		if (entry.directory) {
			result[entry.filename] = new Uint8Array(0);
		} else {
			// Create a Uint8ArrayWriter to receive the data
			const writer = new Uint8ArrayWriter();
			
			// Get the entry data and write it to the writer
			const data = await entry.getData!(writer);
			
			// Store the data in the result object
			result[entry.filename] = data;
		}
	}
	
	// Close the zip reader
	await zipReader.close();
	
	return result;
}

async function unzipToKernelDirectory(
	zipPath: string,
	targetDirectory: string
) {
	// Read the zip file from the kernel filesystem
	const zipData = kernel.readFileSync(zipPath, undefined) as Uint8Array;
	
	// Unzip the data
	const unzipped = await unzip(zipData);
	
	// Write all files to the target directory
	for (const [filePath, fileData] of Object.entries(unzipped)) {
		const fullPath = `${targetDirectory}/${filePath}`;
		
		// Check if this is a directory (ends with /)
		if (filePath.endsWith('/')) {
			kernel.mkdirSync(fullPath.slice(0, -1), { recursive: true });
		} else {
			// Ensure parent directory exists
			ensureParentDirectory(fullPath);
			// Write the file
			kernel.writeFileSync(fullPath, fileData, {});
		}
	}
	
	console.log(`Unzipped ${Object.keys(unzipped).length} entries from ${zipPath} to ${targetDirectory}`);
}

async function fetchAndWriteKernelFile(
	sourcePath: string,
	targetPath: string,
	mode?: number
) {
	const response = await fetch(sourcePath);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch ${sourcePath}: ${response.status} ${response.statusText}`
		);
	}
	const data = new Uint8Array(await response.arrayBuffer());
	ensureParentDirectory(targetPath);
	if (typeof mode === 'number') {
		kernel.writeFileSync(targetPath, data, { mode });
	} else {
		kernel.writeFileSync(targetPath, data, {});
	}
}

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
				console.log('parent message listener:', message);
			});
			worker.on('error', (error) => {
				console.log('error', error);
			});
			setTimeout(() => {
				worker.postMessage('Message from the parent – after 100ms');
			}, 100);
			setTimeout(() => {
				worker.postMessage('Message from the parent – after 500ms'); 
			}, 500);
			worker.postMessage('Message from the parent');
			setTimeout(() => {
				process.exit(0);
			}, 2000);
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
				console.log('worker message listener: ', message);
			});
			parentPort.postMessage('Message from the worker');
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

	static async testPnpmLocal() {
		const pnpmSourceRoot = '/programs/node-loader/pnpm/node_modules/pnpm';
		const pnpmTargetRoot = '/bin/node_modules/.ignored/pnpm';

		kernel.mkdirSync('/bin/node_modules/.ignored/pnpm/dist', { recursive: true });

		const assetsToCopy = [
			{ path: 'LICENSE' },
			{ path: 'README.md' },
			{ path: 'package.json' },
			{ path: 'bin/pnpm.cjs', mode: 0o755 },
			{ path: 'bin/pnpx.cjs', mode: 0o755 },
		];

		for (const asset of assetsToCopy) {
			await fetchAndWriteKernelFile(
				`${pnpmSourceRoot}/${asset.path}`,
				`${pnpmTargetRoot}/${asset.path}`,
				asset.mode
			);
		}

		await fetchAndWriteKernelFile(
			`${pnpmSourceRoot}/dist/rest.zip`,
			`${pnpmTargetRoot}/dist/rest.zip`
		);
		
		// Unzip rest.zip into the dist directory
		await unzipToKernelDirectory(
			`${pnpmTargetRoot}/dist/rest.zip`,
			`${pnpmTargetRoot}/dist`
		);

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

// await TestCases.testWorker();
try {
	await TestCases.testPnpmLocal();
} catch (error) {
	console.error('Error', error);
}

// Log uncaught rejections and errors
globalThis.addEventListener('unhandledrejection', (event) => {
	console.error('Unhandled Rejection at:', event.reason, 'reason:', event.promise);
});

globalThis.addEventListener('error', (event) => {
	console.error('Error:', event);
});


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
