import { installBusybox } from '../runtime/busybox/index.ts';
import { installCustomPrograms } from './programs/index.ts';
import { Kernel } from '../runtime/index.ts';
import { BlobReader, ZipReader, Uint8ArrayWriter } from "@zip.js/zip.js";

const kernel = new Kernel();
globalThis.kernel = kernel;
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

// ------------------------------------------------------------

globalThis.runProgram = function(argv: string[], cwd: string = '/bin') {
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
		await TestCases.installNpm();
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

	static async installNpm() {
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
	}

	static async testPnpmLocal() {
		await TestCases.installNpm();
		kernel.mkdirSync('/tar-experiments', { recursive: true });
		await runProgram(['node', '/bin/npm', 'pack', '@wordpress/scripts'], '/tar-experiments');
		await runProgram(['extract-tar', '/tar-experiments/wordpress-scripts-30.25.0.tgz'], '/tar-experiments');
		// console.log(kernel.readdirSync('/tar-experiments', undefined));
		kernel.writeFileSync(
			`/tar-experiments/package.json`,
			`{
	"name": "@wordpress/scripts",
	"version": "30.25.0",
	"description": "Collection of reusable scripts for WordPress development.",
	"author": "The WordPress Contributors",
	"license": "GPL-2.0-or-later",
	"keywords": [
		"wordpress",
		"gutenberg",
		"scripts"
	],
	"homepage": "https://github.com/WordPress/gutenberg/tree/HEAD/packages/scripts/README.md",
	"repository": {
		"type": "git",
		"url": "https://github.com/WordPress/gutenberg.git",
		"directory": "packages/scripts"
	},
	"bugs": {
		"url": "https://github.com/WordPress/gutenberg/issues"
	},
	"engines": {
		"node": ">=18.12.0",
		"npm": ">=8.19.2"
	},
	"files": [
		"bin",
		"config",
		"plugins",
		"scripts",
		"utils"
	],
	"bin": {
		"wp-scripts": "./bin/wp-scripts.js"
	},
	"dependencies": {
		"@babel/core": "7.25.7",
		"@pmmmwh/react-refresh-webpack-plugin": "^0.5.11",
		"@svgr/webpack": "^8.0.1",
		"@wordpress/browserslist-config": "^6.32.0",
		"@wordpress/dependency-extraction-webpack-plugin": "^6.32.0",
		"@wordpress/postcss-plugins-preset": "^5.32.0",
		"adm-zip": "^0.5.9",
		"babel-loader": "9.2.1",
		"browserslist": "^4.21.10",
		"chalk": "^4.0.0",
		"check-node-version": "^4.1.0",
		"copy-webpack-plugin": "^10.2.0",
		"cross-spawn": "^7.0.6",
		"css-loader": "^6.2.0",
		"cssnano": "^6.0.1",
		"cwd": "^0.10.0",
		"dir-glob": "^3.0.1",
		"fast-glob": "^3.2.7",
		"filenamify": "^4.2.0",
		"json2php": "^0.0.9",
		"merge-deep": "^3.0.3",
		"mini-css-extract-plugin": "^2.9.2",
		"minimist": "^1.2.0",
		"npm-packlist": "^3.0.0",
		"postcss": "^8.4.5",
		"postcss-loader": "^6.2.1",
		"react-refresh": "^0.14.0",
		"read-pkg-up": "^7.0.1",
		"resolve-bin": "^0.4.0",
		"rtlcss": "^4.3.0",
		"sass": "^1.54.0",
		"sass-loader": "^16.0.3",
		"schema-utils": "^4.2.0",
		"source-map-loader": "^3.0.0",
		"terser-webpack-plugin": "^5.3.10",
		"url-loader": "^4.1.1",
		"webpack": "^5.97.0",
		"webpack-bundle-analyzer": "^4.9.1",
		"webpack-cli": "^5.1.4",
		"webpack-dev-server": "^4.15.1"
	},
	"peerDependenciesMeta": {
		"@wordpress/env": {
			"optional": true
		}
	},
	"publishConfig": {
		"access": "public"
	},
	"gitHead": "a030b4c0e0695239b942c7dc18511782b64f10ed"
}`,
			{ mode: 0o755 }
		);

		// "@wordpress/babel-preset-default": "^8.32.0",


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
		kernel.writeFileSync(
			`/pnpm-project/cowsay-demo.js`,
			`
		const cowsay = require('cowsay');
		console.log(cowsay.say({
			text : "I'm a moooodule",
			e : "oO",
			T : "U "
		}));
		`,
			{ mode: 0o755 }
		);

		await runProgram(
			[
				'node',
				'/bin/node_modules/.ignored/pnpm/bin/pnpm.cjs',
				'install',
			],
			'/tar-experiments'
		);
		// await runProgram(
		// 	[
		// 		'node',
		// 		'/bin/node_modules/.ignored/pnpm/bin/pnpm.cjs',
		// 		'install',
		// 		'cowsay',
		// 	],
		// 	'/pnpm-project'
		// );
	}

	static async testWpScriptsLocal() {
		kernel.mkdirSync('/wp-scripts-experiments', { recursive: true });
		await fetchAndWriteKernelFile(
			`/programs/node-loader/wp-scripts/wp-scripts.zip`,
			`/wp-scripts-experiments/wp-scripts.zip`
		);
		
		// Unzip rest.zip into the dist directory
		await unzipToKernelDirectory(
			`/wp-scripts-experiments/wp-scripts.zip`,
			`/wp-scripts-experiments`
		);

		// Create a simple block
		kernel.mkdirSync('/jsx/my-block', { recursive: true });
kernel.writeFileSync('/jsx/my-block/block.json', `{
	"$schema": "https://json.schemastore.org/block.json",
	"apiVersion": 2,
	"name": "gutenberg-examples/example-01-basic-esnext",
	"title": "Example: Basic (ESNext)",
	"textdomain": "gutenberg-examples",
	"icon": "universal-access-alt",
	"category": "jsx-examples",
	"example": {},
	"editorScript": "file:./index.js"
}`);
kernel.writeFileSync('/jsx/my-block/edit.js', `/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useBlockProps } from '@wordpress/block-editor';

/**
 * Internal dependencies
 */
import { blockStyle } from './index';

const Edit = () => {
	const blockProps = useBlockProps( { style: blockStyle } );
	return (
		<div { ...blockProps }>
			{ __(
				'Hello World, step 1 (from the editor).',
				'gutenberg-examples'
			) }
		</div>
	);
};
export default Edit;`);

kernel.writeFileSync('/jsx/my-block/edit.js', `/**
 * WordPress dependencies
 */
import { registerBlockType } from '@wordpress/blocks';

/**
 * Internal dependencies
 */
import json from './block.json';
import Edit from './edit';
import save from './save';

// Export this so we can use it in the edit and save files
export const blockStyle = {
	backgroundColor: '#900',
	color: '#fff',
	padding: '20px',
};

// Destructure the json file to get the name of the block
// For more information on how this works, see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment
const { name } = json;

// Register the block
registerBlockType( name, {
	edit: Edit,
	save, // Object shorthand property - same as writing: save: save,
} );`);
kernel.writeFileSync('/jsx/my-block/index.php', `<?php
/**
 * Plugin Name: Gutenberg Examples Basic EsNext
 * Plugin URI: https://github.com/WordPress/gutenberg-examples
 * Description: This is a plugin demonstrating how to register new blocks for the Gutenberg editor.
 * Version: 1.1.0
 * Author: the Gutenberg Team
 *
 * @package gutenberg-examples
 */

defined( 'ABSPATH' ) || exit;

/**
 * Load all translations for our plugin from the MO file.
 */
function gutenberg_examples_01_esnext_load_textdomain() {
	load_plugin_textdomain( 'gutenberg-examples', false, basename( __DIR__ ) . '/languages' );
}
add_action( 'init', 'gutenberg_examples_01_esnext_load_textdomain' );

/**
 * Registers all block assets so that they can be enqueued through Gutenberg in
 * the corresponding context.
 *
 * Passes translations to JavaScript.
 */
function gutenberg_examples_01_esnext_register_block() {

	// Register the block by passing the location of block.json to register_block_type.
	register_block_type( __DIR__ );

	if ( function_exists( 'wp_set_script_translations' ) ) {
		/**
		 * May be extended to wp_set_script_translations( 'my-handle', 'my-domain',
		 * plugin_dir_path( MY_PLUGIN ) . 'languages' ) ). For details see
		 * https://make.wordpress.org/core/2018/11/09/new-javascript-i18n-support-in-wordpress/
		 */
		wp_set_script_translations( 'gutenberg-examples-01-esnext', 'gutenberg-examples' );
	}

}
add_action( 'init', 'gutenberg_examples_01_esnext_register_block' );`);

kernel.writeFileSync('/jsx/my-block/save.js', `/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useBlockProps } from '@wordpress/block-editor';

/**
 * Internal dependencies
 */
import { blockStyle } from './index';

const Save = () => {
	const blockProps = useBlockProps.save( { style: blockStyle } );
	return (
		<div { ...blockProps }>
			{ __(
				'Hello World, step 1 (from the frontend).',
				'gutenberg-examples'
			) }
		</div>
	);
};
export default Save;`);
		
		kernel.writeFileSync('/jsx/package.json', `{
			"name": "gutenberg-examples",
			"version": "1.1.0",
			"private": true,
			"description": "Gutenberg Examples",
			"author": "The WordPress Contributors",
			"license": "GPL-2.0-or-later",
			"keywords": [
				"WordPress",
				"editor",
				"Examples"
			],
			"homepage": "https://github.com/WordPress/gutenberg-examples/",
			"repository": "git+https://github.com/WordPress/gutenberg-examples.git",
			"bugs": {
				"url": "https://github.com/WordPress/gutenberg-examples/issues"
			}
		}`);

		// Move node_modules to the top level so it can always be found by wp-scripts.
		kernel.renameSync('/node_modules', '/node_modules_old');
		kernel.renameSync('/wp-scripts-experiments/package/node_modules', '/node_modules');

		kernel.mkdirSync('/build/blocks', { recursive: true });
		await runProgram(
			[
				'node',
				'/wp-scripts-experiments/package/bin/wp-scripts.js',
				'build',
				'--webpack-copy-php',
				'--webpack-src-dir=/jsx',
				'--webpack-output-path=/build/blocks'
			],
			'/jsx'
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
	await TestCases.testWpScriptsLocal();
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


