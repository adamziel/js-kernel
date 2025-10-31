import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../runtime/index.ts';
import { installCustomPrograms } from './programs/index.ts';
import { ZipReader, BlobReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import esBundlerZipUrl from './programs/node-loader/es-bundler.zip?url';
import bundleFixtureSource from './tests/fixtures/esbuild-wasm/bundle.js?raw';
const npmSingle = '/programs/node-loader/npm/npm-single.js?raw';
const defaultInput = '/programs/node-loader/npm/default-input.js?raw';
import './read-opfs-logs.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const BUNDLE_OUTPUT_PATH = '/tmp/esbuild-bundle-fs.txt';

async function createSimpleBlock(kernel: Kernel) {
	// Create a simple block
	kernel.mkdirSync('/esbuild/src', { recursive: true });
	kernel.writeFileSync(
		'/esbuild/src/block.json',
		`{
		"$schema": "https://json.schemastore.org/block.json",
		"apiVersion": 2,
		"name": "gutenberg-examples/example-01-basic-esnext",
		"title": "Example: Basic (ESNext)",
		"textdomain": "gutenberg-examples",
		"icon": "universal-access-alt",
		"category": "jsx-examples",
		"example": {},
		"editorScript": "file:./index.js"
	}`
	);
	kernel.writeFileSync(
		'/esbuild/src/index.js',
		`/**
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
		} );`
	);
	kernel.writeFileSync(
		'/esbuild/src/edit.js',
		`/**
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
	export default Edit;`
	);

	kernel.writeFileSync(
		'/esbuild/src/save.js',
		`/**
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
	export default Save;`
	);
	kernel.writeFileSync(
		'/esbuild/src/index.php',
		`<?php
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
	add_action( 'init', 'gutenberg_examples_01_esnext_register_block' );`
	);

	kernel.writeFileSync(
		'/esbuild/src/save.js',
		`/**
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
	export default Save;`
	);

	kernel.writeFileSync(
		'/esbuild/package.json',
		`{
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
	}`
	);
}

const prepareEsbuildEnvironment = async (kernel: Kernel) => {
	const response = await fetch(esBundlerZipUrl);
	if (!response.ok) {
		throw new Error('Failed to fetch es-bundler.zip');
	}
	const bundleZip = await response.arrayBuffer();
	kernel.mkdirSync('/esbuild', { recursive: true });
	kernel.mkdirSync('/tmp', { recursive: true });
	kernel.writeFileSync(
		'/esbuild/es-bundler.zip',
		new Uint8Array(bundleZip),
		null
	);
	await unzipKernelFile(kernel, '/esbuild/es-bundler.zip', '/esbuild');
	kernel.mkdirSync('/esbuild/src', { recursive: true });
	// kernel.writeFileSync(
	// 	'/esbuild/src/index.js',
	// 	encoder.encode(`export const answer = 21 * 2;`),
	// 	null
	// );
	if (kernel.existsSync(BUNDLE_OUTPUT_PATH)) {
		kernel.unlinkSync(BUNDLE_OUTPUT_PATH);
	}
};

const chunkToString = (chunk: string | Uint8Array) =>
	typeof chunk === 'string' ? chunk : decoder.decode(chunk);

async function unzipKernelFile(
	kernel: Kernel,
	source: string,
	targetDir: string
) {
	const data = kernel.readFileSync(source, null) as ArrayBuffer;
	const zipReader = new ZipReader(new BlobReader(new Blob([data])));
	const entries = await zipReader.getEntries();
	for (const entry of entries) {
		if (!entry.getData) continue;
		const writer = new Uint8ArrayWriter();
		const content = await entry.getData(writer);
		const outputPath = `${targetDir}/${entry.filename}`.replace(/\\/g, '/');
		const dirPath = outputPath.substring(0, outputPath.lastIndexOf('/'));
		if (dirPath) {
			kernel.mkdirSync(dirPath, { recursive: true });
		}
		if (entry.directory) {
			kernel.mkdirSync(outputPath, { recursive: true });
			continue;
		}
		kernel.writeFileSync(outputPath, content);
	}
	await zipReader.close();
}

async function installNpm(kernel: Kernel) {
	kernel.writeFileSync('/bin/npm', npmSingle, { mode: 0o755 });
	kernel.writeFileSync('/bin/default-input.js', defaultInput, {
		mode: 0o755,
	});
}

describe.sequential('esbuild integration', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');
		installCustomPrograms(kernel);
	});

	const createRunnerSource = (entryType: 'virtual' | 'fs') => {
		const virtualEntryBlock = String.raw`const wasmPath = '/esbuild/node_modules/esbuild-wasm/esbuild.wasm';
	const wasmBytesCheck = fsSync.readFileSync(wasmPath, null);
	console.log('[runner] wasm bytes length', wasmBytesCheck ? wasmBytesCheck.byteLength || wasmBytesCheck.length : 'null');
	const entrySource = fsSync.readFileSync('/esbuild/src/index.js', 'utf8');

	console.log('[runner] about to call esbuild.build()');
	const result = await esbuild.build({
		bundle: true,
		format: 'esm',
		write: false,
		minifySyntax: true,
		stdin: {
			contents: entrySource,
			resolveDir: '/esbuild/src',
			sourcefile: 'virtual-entry.js',
			loader: 'js',
		},
	});
	console.log('[runner] esbuild.build() completed');`;

		const filesystemEntryBlock = String.raw`console.log('[runner] about to call esbuild.build() with fs entry');
	const fsEntrySource = fsSync.readFileSync('/esbuild/src/index.js', 'utf8');
	const result = await esbuild.build({
		bundle: true,
		format: 'esm',
		minifySyntax: true,
		write: false,
		stdin: {
			contents: fsEntrySource,
			resolveDir: '/esbuild/src',
			sourcefile: 'fs-entry.js',
			loader: 'js',
		},
	});
	console.log('[runner] esbuild.build() with fs entry completed');`;
		const buildBlock =
			entryType === 'virtual' ? virtualEntryBlock : filesystemEntryBlock;

		const bundleOutputPath =
			entryType === 'virtual'
				? "'/tmp/esbuild-bundle-virtual.txt'"
				: "'/tmp/esbuild-bundle-fs.txt'";

		return `
async function main() {
	console.log('[runner] buffer check', Buffer.from('').constructor.name, Buffer.from('') instanceof Uint8Array);
	const originalReadFileSync = processController.fsSync.readFileSync;
	processController.fsSync.readFileSync = function (...args) {
		const [path, options] = args;
		try {
			const result = originalReadFileSync.apply(this, args);
			const length =
				typeof result === 'string'
					? result.length
					: result && typeof result === 'object'
					? result.byteLength ?? result.length ?? 0
					: 0;
			console.log('[fsSync.readFileSync]', path, { length, options });
			return result;
		} catch (error) {
			console.log('[fsSync.readFileSync] error', path, error && error.message);
			throw error;
		}
	};
	const wrapFsSyncMethod = (name) => {
		const original = processController.fsSync?.[name];
		if (typeof original !== 'function') {
			return;
		}
		processController.fsSync[name] = function (...methodArgs) {
			const describeArg = (arg) => {
				if (typeof arg === 'string') {
					return arg;
				}
				if (typeof arg === 'number' || typeof arg === 'boolean') {
					return arg;
				}
				if (arg && typeof arg === 'object') {
					const ctor = arg.constructor && arg.constructor.name ? arg.constructor.name : Object.prototype.toString.call(arg);
					const length = arg.byteLength ?? arg.length ?? undefined;
					if (length !== undefined) {
						return '[' + ctor + ' len=' + length + ']';
					}
					return ctor;
				}
				return typeof arg;
			};
			const summary = methodArgs.map(describeArg);
			try {
				const result = original.apply(this, methodArgs);
				const resultSummary = result && typeof result === 'object'
					? '[' + (result.constructor && result.constructor.name ? result.constructor.name : 'Object') + ' len=' + (result.byteLength ?? result.length ?? '') + ']'
					: result;
				console.log('[fsSync.' + name + ']', summary, '->', resultSummary);
				return result;
			} catch (err) {
				console.log('[fsSync.' + name + '] error', summary, err && err.message);
				throw err;
			}
		};
	};
	[
		'writeFileSync',
		'mkdirSync',
		'mkdtempSync',
		'unlinkSync',
		'renameSync',
		'openSync',
		'closeSync',
		'statSync',
		'fstatSync',
		'lstatSync',
		'realpathSync',
		'existsSync',
		'chmodSync',
		'chownSync',
		'cpSync',
		'writeFileUtf8Sync',
		'writeBufferSync'
	].forEach(wrapFsSyncMethod);
	process.on('unhandledRejection', (reason) => {
		console.log('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
	});
	process.on('uncaughtException', (error) => {
		console.log('[uncaughtException]', error && error.stack ? error.stack : error);
	});
	console.log('[runner] starting main, entryType: ${entryType}');
	const __origWebAssemblyModule = WebAssembly.Module;
	WebAssembly.Module = function(bytes, importObject) {
		const len = bytes && (bytes.length || bytes.byteLength || 0);
		console.log('[runner] WebAssembly.Module called with length', len);
		return new __origWebAssemblyModule(bytes, importObject);
	};
	const esbuild = require('/esbuild/node_modules/esbuild-wasm/lib/main.js');
	console.log('[runner] required esbuild main');
	const fsSync = processController.fsSync;
	const nodeFs = require('fs');
	console.log('[runner] required fs');
	const childProcess = require('child_process');
	console.log('[runner] child_process keys', Object.keys(childProcess));
	console.log('[runner] typeof execFileSync', typeof childProcess.execFileSync);

	const normalizeReaddirEncoding = (value) => {
		if (typeof value === 'string') {
			return value;
		}
		if (value && typeof value.encoding === 'string') {
			return value.encoding;
		}
		return 'utf8';
	};

	nodeFs.readdirSync = (path, options) => {
		console.log('[runner] readdirSync request for', path);
		const encoding = normalizeReaddirEncoding(options);
		return fsSync.readdirSync(path, encoding);
	};

	nodeFs.readdir = (path, options, callback) => {
		console.log('[runner] readdir request for', path);
		if (typeof options === 'function') {
			callback = options;
			options = undefined;
		}
		const encoding = normalizeReaddirEncoding(options);
		const run = () => fsSync.readdirSync(path, encoding);
		if (typeof callback === 'function') {
			try {
				callback(null, run());
			} catch (error) {
				callback(error);
			}
			return;
		}
		return Promise.resolve().then(run);
	};

	if (nodeFs.promises && typeof nodeFs.promises.readdir === 'function') {
		nodeFs.promises.readdir = async (path, options) => nodeFs.readdirSync(path, options);
	}

	await esbuild.initialize({ worker: false });
	console.log('[runner] esbuild initialized successfully');

	${buildBlock}

	const outputFiles = Array.isArray(result.outputFiles)
		? result.outputFiles
		: [];
	const outputText = outputFiles.length > 0 && outputFiles[0]
		? String(outputFiles[0].text || '')
		: '';
	console.log('[runner] raw output', outputText);
const bundleOutputPath = ${bundleOutputPath};
fsSync.writeFileSync(bundleOutputPath, outputText, 'utf8');
console.log('[runner] bundle written to', bundleOutputPath);
processController.exit(0);
}

main().catch((error) => {
	const message =
		error && typeof error === 'object' && 'stack' in error
			? String(error.stack)
			: String(error);
	processController.stderr.write(message);
	processController.exit(1);
});
`;
	};

	const runEsbuildRunner = async (entryType: 'virtual' | 'fs') => {
		await installNpm(kernel);
		await createSimpleBlock(kernel);
		await prepareEsbuildEnvironment(kernel);

		const mainJsPath = '/esbuild/node_modules/esbuild-wasm/lib/main.js';
		const mainJsOriginal = kernel.readFileSync(mainJsPath, 'utf8');
		let mainJsInstrumented = mainJsOriginal;

		if (!mainJsOriginal.includes('[esbuild-channel] afterClose')) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let afterClose = (error) => {',
				`let afterClose = (error) => {
	console.log('[esbuild-channel] afterClose', { reason: closeData.reason, error });`
			);
		}

		if (
			!mainJsInstrumented.includes('[esbuild-main] handleRequest command')
		) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let handleRequest = async (id, request) => {',
				`let handleRequest = async (id, request) => {
\tconsole.log('[esbuild-main] handleRequest command', request && request.command, 'id', id, 'requestKeys:', request && Object.keys(request || {}));`
			);
		}

		if (
			!mainJsInstrumented.includes(
				'[esbuild-main] handlePlugins running with'
			)
		) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'if (plugins && plugins.length > 0) {',
				`if (plugins && plugins.length > 0) {
\tconsole.log('[esbuild-main] handlePlugins running with', plugins.length, 'plugins');`
			);
		}

		// Add logging to readFromStdout to see if it's being called and buffer status
		if (
			!mainJsInstrumented.includes('[esbuild-main] readFromStdout called')
		) {
			mainJsInstrumented = mainJsInstrumented.replace(
				/let readFromStdout = \(chunk\) => \{[\s\S]*?stdoutUsed \+= chunk\.length;/,
				`let readFromStdout = (chunk) => {
	const len = chunk && (chunk.length || chunk.byteLength || 0);
	const chunkType = typeof chunk;
	const chunkCtor = chunk && chunk.constructor && chunk.constructor.name;
	const isUint8 = chunk instanceof Uint8Array;
	console.log('[esbuild-main] readFromStdout called with', len, 'bytes, type:', chunkType, chunkCtor, 'isUint8Array:', isUint8, 'stdoutUsed before:', stdoutUsed);
    let limit = stdoutUsed + chunk.length;
    if (limit > stdout.length) {
      let swap = new Uint8Array(limit * 2);
      swap.set(stdout);
      stdout = swap;
    }
    try {
      stdout.set(chunk, stdoutUsed);
    } catch (err) {
      console.log('[esbuild-main] ERROR in stdout.set:', err && err.message, 'chunk type:', typeof chunk, chunk.constructor.name);
      throw err;
    }
    stdoutUsed += chunk.length;
    console.log('[esbuild-main] after buffering: stdoutUsed =', stdoutUsed, 'stdout.length =', stdout.length);`
			);
		}

		// Add logging to the packet parsing loop
		if (!mainJsInstrumented.includes('[esbuild-main] parsing loop')) {
			mainJsInstrumented = mainJsInstrumented.replace(
				/let offset = 0;\s*while \(offset \+ 4 <= stdoutUsed\) \{\s*let length = readUInt32LE\(stdout, offset\);/,
				`let offset = 0;
    console.log('[esbuild-main] parsing loop: offset=', offset, 'stdoutUsed=', stdoutUsed);
    while (offset + 4 <= stdoutUsed) {
      console.log('[esbuild-main] parsing loop iteration: offset=', offset);
      let length = readUInt32LE(stdout, offset);
      console.log('[esbuild-main] packet length read:', length, 'need', offset + 4 + length, 'have', stdoutUsed);`
			);
		}

		// Add logging to handleIncomingPacket
		if (
			!mainJsInstrumented.includes('[esbuild-main] handleIncomingPacket')
		) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let handleIncomingPacket = (bytes) => {',
				`let handleIncomingPacket = (bytes) => {
	console.log('[esbuild-main] handleIncomingPacket called with', bytes && bytes.length);`
			);
		}

		// Add logging to stdout.on setup
		if (
			!mainJsInstrumented.includes(
				'[esbuild-main] setting up stdout listener'
			)
		) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'stdout.on("data", readFromStdout);',
				`console.log('[esbuild-main] setting up stdout listener on', stdout && stdout.constructor && stdout.constructor.name);
stdout.on("data", readFromStdout);`
			);
		}

		// Add logging to stdin writes to see if responses are being sent
		if (
			!mainJsInstrumented.includes('[esbuild-main] writeToStdin called')
		) {
			mainJsInstrumented = mainJsInstrumented.replace(
				/streamIn\.writeToStdin\(/g,
				`(function(bytes) {
	console.log('[esbuild-main] writeToStdin called with', bytes && bytes.length, 'bytes');
	return streamIn.writeToStdin(bytes);
})(`
			);
		}

		// Add logging to sendRequest to observe outgoing commands
		if (!mainJsInstrumented.includes('[esbuild-main] sendRequest called')) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let sendRequest = (refs, value, callback) => {',
				`let sendRequest = (refs, value, callback) => {
\tlet serializedValue = '<unserializable>';
\ttry {
\t\tserializedValue = JSON.stringify(value, (key, val) => typeof val === 'function' ? '[Function]' : val);
\t} catch {}
\tconsole.log('[esbuild-main] sendRequest called for command', value && value.command, 'id will be', nextRequestID, 'keys:', value && Object.keys(value), 'plugins:', value && value.plugins ? value.plugins.length : 0, 'payload:', serializedValue);`
			);
		}

		// Periodic logging of pending response callbacks
		if (
			!mainJsInstrumented.includes(
				'[esbuild-main] pending responseCallbacks'
			)
		) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let responseCallbacks = {};',
				`let responseCallbacks = {};
setTimeout(() => {
\ttry {
\t\tconsole.log('[esbuild-main] pending responseCallbacks', Object.keys(responseCallbacks || {}));
\t} catch (err) {
\t\tconsole.log('[esbuild-main] pending responseCallbacks error', err && err.message);
\t}
}, 2000);`
			);
		}

		// Add logging to sendResponse to see if responses are attempted
		if (
			!mainJsInstrumented.includes('[esbuild-main] sendResponse called')
		) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let sendResponse = (id, value) => {',
				`let sendResponse = (id, value) => {
	console.log('[esbuild-main] sendResponse called for id', id, 'value keys:', value && Object.keys(value));`
			);
		}

		kernel.writeFileSync(mainJsPath, mainJsInstrumented, 'utf8');

		kernel.mkdirSync('/esbuild/src', { recursive: true });
		kernel.writeFileSync(
			'/esbuild/src/index.js',
			encoder.encode(`export const answer = 21 * 2;`),
			null
		);

		const runnerSource = createRunnerSource(entryType);
		console.log(`[test] runner source for ${entryType} (truncated)`);
		// console.log(runnerSource);  // Too verbose, skip logging full source
		kernel.writeFileSync('/test-esbuild.js', runnerSource, 'utf8');

		const subprocess = kernel.spawn({
			argv: ['node', '/test-esbuild.js'],
			env: {
				PATH: '/bin',
				TMPDIR: '/tmp',
				HOME: '/home',
				ESBUILD_LOG_LEVEL: 'debug',
			},
			cwd: '/',
			name: 'esbuild',
			stdio: {
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		expect(typeof subprocess).not.toBe('number');
		if (typeof subprocess === 'number') {
			throw new Error(
				'failed to spawn node program, exit code: ' + subprocess
			);
		}

		let stdout = '';
		let stderr = '';
		subprocess.stdout?.on('data', (chunk) => {
			const text = chunkToString(chunk);
			console.log('[child stdout]', text);
			stdout += text;
		});
		subprocess.stderr?.on('data', (chunk) => {
			const text = chunkToString(chunk);
			console.log('[child stderr]', text);
			stderr += text;
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});
		try {
			if (kernel.existsSync('/esbuild-wasm-dump.bin')) {
				const dump = kernel.readFileSync(
					'/esbuild-wasm-dump.bin',
					null
				) as Uint8Array | string;
				const length =
					typeof dump === 'string'
						? dump.length
						: dump.byteLength ?? dump.length;
				console.log('[test] wasm dump length', length);
			} else {
				console.log('[test] wasm dump missing');
			}
		} catch (error) {
			console.log('[test] wasm dump read error', error);
		}

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');

		const bundleOutputPath =
			entryType === 'virtual'
				? '/tmp/esbuild-bundle-virtual.txt'
				: '/tmp/esbuild-bundle-fs.txt';
		const bundleExists = kernel.existsSync(bundleOutputPath);
		expect(bundleExists).toBe(true);
		const bundleTextRaw = bundleExists
			? (kernel.readFileSync(bundleOutputPath, 'utf8') as string)
			: '';
		return bundleTextRaw;
	};

	const runBundleFixture = async () => {
		await prepareEsbuildEnvironment(kernel);
		await createSimpleBlock(kernel);
		await installNpm(kernel);
		const scriptPath = '/esbuild/bundle.js';
		kernel.writeFileSync(
			scriptPath,
			encoder.encode(bundleFixtureSource),
			null
		);
		// const npmInstallSubprocess = kernel.spawn({
		// 	argv: ['node', '/bin/npm', 'install'],
		// 	cwd: '/esbuild',
		// 	name: 'npm-install',
		// 	env: {},
		// 	stdio: {
		// 		stdin: 'ignore',
		// 		stdout: 'inherit',
		// 		stderr: 'inherit',
		// 	},
		// });
		// if (typeof npmInstallSubprocess === 'number') {
		// 	throw new Error('failed to spawn npm: ' + npmInstallSubprocess);
		// }
		// await new Promise((resolve) => {
		// 	npmInstallSubprocess.onExit((code) => resolve(code ?? 0));
		// });

		console.log(kernel.readdirSync('/esbuild'));

		const subprocess = kernel.spawn({
			argv: ['node', scriptPath, '/esbuild/src', BUNDLE_OUTPUT_PATH],
			env: {
				PATH: '/bin',
				TMPDIR: '/tmp',
				HOME: '/home',
				ESBUILD_LOG_LEVEL: 'debug',
			},
			cwd: '/esbuild',
			name: 'esbuild-bundle-fixture',
			stdio: {
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		if (typeof subprocess === 'number') {
			throw new Error('failed to spawn bundle fixture');
		}

		let stdout = '';
		let stderr = '';

		subprocess.stdout?.on('data', (chunk) => {
			stdout += chunkToString(chunk);
		});

		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk);
		});

		const exitCode: number = await new Promise((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		const bundleText = kernel.existsSync(BUNDLE_OUTPUT_PATH)
			? (kernel.readFileSync(BUNDLE_OUTPUT_PATH, 'utf8') as string)
			: '';
		return { exitCode, stdout, stderr, bundleText };
	};

	// TODO: esbuild WASM hangs during build IPC communication
	// - esbuild.initialize() works (service starts successfully)
	// - esbuild.build() sends request but service never responds
	// - IPC shows "ping" command being received but not responded to
	// - Requires deep debugging of esbuild WASM IPC protocol
	// Fixed issues that were blocking:
	// - Stdin polling intervals now properly cleaned up (no more hanging processes)
	// - Default stdin changed from 'pipe' to 'ignore' for spawned processes
	it('can bundle via esbuild-wasm using virtual entry', async () => {
		const bundleText = await runEsbuildRunner('virtual');
		expect(bundleText).toContain('answer = 42');
	}, 20000);

	it('can bundle via esbuild-wasm using filesystem entry', async () => {
		const bundleText = await runEsbuildRunner('fs');
		expect(bundleText).toContain('answer = 42');
	}, 20000);

	it.only('can bundle via esbuild-wasm using bundle fixture script', async () => {
		const { exitCode, stderr, bundleText } = await runBundleFixture();
		expect(stderr).toBe('');
		expect(exitCode).toBe(0);
		expect(bundleText).toContain('answer = 42');
	}, 2000000);
});
