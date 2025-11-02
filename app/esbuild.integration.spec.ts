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
	installWordPressStubs(kernel);

	// Create a simple block structure similar to Gutenberg examples
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

async function createSimpleImportFixture(kernel: Kernel) {
	console.error('[test] createSimpleImportFixture');
	kernel.mkdirSync('/esbuild/src', { recursive: true });
	kernel.writeFileSync('/esbuild/src/helper.js', `export const answer = 42;`);
	kernel.writeFileSync(
		'/esbuild/src/index.js',
		`import { answer } from './helper.js';

export { answer };
`
	);
}

async function createSimpleNodeModulesFixture(kernel: Kernel) {
	console.error('[test] createSimpleNodeModulesFixture');
	kernel.mkdirSync('/esbuild/src', { recursive: true });
	kernel.mkdirSync('/esbuild/node_modules/my-package', { recursive: true });
	kernel.writeFileSync(
		'/esbuild/node_modules/my-package/index.js',
		`export const fromPackage = 'Hello from node_modules';`
	);
	kernel.writeFileSync(
		'/esbuild/node_modules/my-package/package.json',
		JSON.stringify({ name: 'my-package', type: 'module', main: 'index.js' })
	);
	kernel.writeFileSync(
		'/esbuild/src/index.js',
		`import { fromPackage } from 'my-package';

export const message = fromPackage + ' via esbuild';
`
	);
}

function installWordPressStubs(kernel: Kernel) {
	const baseDir = '/esbuild/src/node_modules';
	const modules = [
		{
			name: '@wordpress/blocks',
			source: `export function registerBlockType(name, definition) {
	if (typeof name !== 'string') {
		throw new TypeError('Block name must be a string');
	}
	if (!definition || typeof definition !== 'object') {
		throw new TypeError('Block definition must be an object');
	}
	return { name, ...definition };
}

export default { registerBlockType };`,
		},
		{
			name: '@wordpress/i18n',
			source: `export function __(text) {
	return typeof text === 'string' ? text : '';
}

export default { __ };`,
		},
		{
			name: '@wordpress/block-editor',
			source: `const useBlockProps = (options = {}) => ({
	style: options.style || {},
});

useBlockProps.save = (options = {}) => ({
	style: options.style || {},
});

export { useBlockProps };

export default { useBlockProps };`,
		},
	];

	for (const mod of modules) {
		const moduleDir = `${baseDir}/${mod.name}`;
		kernel.mkdirSync(moduleDir, { recursive: true });
		kernel.writeFileSync(`${moduleDir}/index.js`, mod.source, 'utf8');
		kernel.writeFileSync(
			`${moduleDir}/package.json`,
			JSON.stringify({
				name: mod.name,
				main: './index.js',
				type: 'module',
			}),
			'utf8'
		);
	}

	try {
		console.error(
			'[installWordPressStubs]',
			kernel.readdirSync(`${baseDir}/@wordpress`)
		);
	} catch (error) {
		console.error('[installWordPressStubs] error listing stubs', error);
	}
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
	console.error('[runner] wasm bytes length', wasmBytesCheck ? wasmBytesCheck.byteLength || wasmBytesCheck.length : 'null');
	const entrySource = fsSync.readFileSync('/esbuild/src/index.js', 'utf8');

	console.error('[runner] about to call esbuild.build()');
	const result = await esbuild.build({
		bundle: true,
		format: 'esm',
		write: false,
		minifySyntax: true,
		absWorkingDir: '/esbuild',
		stdin: {
			contents: entrySource,
			resolveDir: '/esbuild/src',
			sourcefile: 'virtual-entry.js',
			loader: 'js',
		},
	});
	console.error('[runner] esbuild.build() completed');`;

		const filesystemEntryBlock = String.raw`console.error('[runner] about to call esbuild.build() with fs entry');
	const entrySource = fsSync.readFileSync('/esbuild/src/index.js', 'utf8');
	const result = await esbuild.build({
		bundle: true,
		format: 'esm',
		minifySyntax: true,
		write: false,
		absWorkingDir: '/esbuild/src',
		stdin: {
			contents: entrySource,
			resolveDir: '/esbuild/src',
			sourcefile: 'index.js',
			loader: 'js',
		},
	});
	console.error('[runner] esbuild.build() with fs entry completed');`;
		const buildBlock =
			entryType === 'virtual' ? virtualEntryBlock : filesystemEntryBlock;

		const bundleOutputPath =
			entryType === 'virtual'
				? "'/tmp/esbuild-bundle-virtual.txt'"
				: "'/tmp/esbuild-bundle-fs.txt'";

		return `
async function main() {
	console.error('[runner] buffer check', Buffer.from('').constructor.name, Buffer.from('') instanceof Uint8Array);
	const originalReadFileSync = processController.fsSync.readFileSync;
	processController.fsSync.readFileSync = function (...args) {
		return originalReadFileSync.apply(this, args);
	};
	const wrapFsSyncMethod = (name) => {
		const original = processController.fsSync?.[name];
		if (typeof original !== 'function') {
			return;
		}
		processController.fsSync[name] = function (...methodArgs) {
			const normalizedArgs = methodArgs.map((arg) =>
				shouldNormalizePathString(arg) ? resolveFsPath(arg) : arg
			);
			try {
				console.error('[runner fsSync]', name, normalizedArgs[0]);
			} catch {}
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
			const summary = normalizedArgs.map(describeArg);
			try {
				const result = original.apply(this, normalizedArgs);
				const resultSummary = result && typeof result === 'object'
					? '[' + (result.constructor && result.constructor.name ? result.constructor.name : 'Object') + ' len=' + (result.byteLength ?? result.length ?? '') + ']'
					: result;
				return result;
			} catch (err) {
				throw err;
			}
		};
	};
	process.on('unhandledRejection', (reason) => {
		console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
	});
	process.on('uncaughtException', (error) => {
		console.error('[uncaughtException]', error && error.stack ? error.stack : error);
	});
	console.error('[runner] starting main, entryType: ${entryType}');
	const __origWebAssemblyModule = WebAssembly.Module;
	WebAssembly.Module = function(bytes, importObject) {
		const len = bytes && (bytes.length || bytes.byteLength || 0);
		console.error('[runner] WebAssembly.Module called with length', len);
		return new __origWebAssemblyModule(bytes, importObject);
	};
	const fsSync = processController.fsSync;
	const nodeFs = require('fs');
	console.error('[runner] required fs');
	const path = require('path');
	console.error('[runner] required path');
	const childProcess = require('child_process');
	console.error('[runner] child_process keys', Object.keys(childProcess));
	console.error('[runner] typeof execFileSync', typeof childProcess.execFileSync);
	console.error('[runner] path.join(/esbuild/src, ./index.js)', path.join('/esbuild/src', './index.js'));
	console.error('[runner] path.resolve(/esbuild/src, ./index.js)', path.resolve('/esbuild/src', './index.js'));

	try {
		process.chdir('/esbuild');
		console.error('[runner] chdir to /esbuild');
	} catch (chdirError) {
		console.error('[runner] chdir failed', chdirError && chdirError.message);
	}

	const normalizeReaddirEncoding = (value) => {
		if (typeof value === 'string') {
			return value;
		}
		if (value && typeof value.encoding === 'string') {
			return value.encoding;
		}
		return 'utf8';
	};

	const resolveFsPath = (value) => {
		if (typeof value !== 'string') {
			return value;
		}
		if (value === '' || value === '.') {
			const cwd =
				typeof process !== 'undefined' && typeof process.cwd === 'function'
					? process.cwd()
					: '/';
			const resolvedCwd = cwd || '/';
			return resolvedCwd;
		}
		if (value.startsWith('/')) {
			return value;
		}
		const resolver =
			path.posix && typeof path.posix.resolve === 'function'
				? path.posix.resolve
				: path.resolve;
		const baseDir =
			typeof process !== 'undefined' && typeof process.cwd === 'function'
				? process.cwd() || '/'
				: '/';
		return resolver(baseDir, value);
	};

	const shouldNormalizePathString = (value) =>
		typeof value === 'string' &&
		(value === '' ||
			value === '.' ||
			value === '..' ||
			value.includes('/') ||
			value.includes('\\\\'));

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
		'readdirSync',
		'realpathSync',
		'existsSync',
		'chmodSync',
		'chownSync',
		'cpSync',
		'writeFileUtf8Sync',
		'writeBufferSync'
	].forEach(wrapFsSyncMethod);

	const wrapNodeFsMethod = (name, pathArgIndexes = [0]) => {
		const original = nodeFs?.[name];
		const target = fsSync?.[name];
		if (typeof original !== 'function' || typeof target !== 'function') {
			return;
		}
	nodeFs[name] = function (...methodArgs) {
		const normalizedArgs = methodArgs.map((arg, index) =>
			pathArgIndexes.includes(index) && shouldNormalizePathString(arg)
				? resolveFsPath(arg)
				: arg
		);
		try {
			console.error('[runner nodeFs]', name, normalizedArgs[0]);
		} catch {}
			try {
				return target.apply(fsSync, normalizedArgs);
			} catch (error) {
				throw error;
			}
		};
	};

	[
		['readFileSync', [0]],
		['statSync', [0]],
		['lstatSync', [0]],
		['existsSync', [0]],
		['realpathSync', [0]],
		['unlinkSync', [0]],
		['renameSync', [0, 1]],
	].forEach(([method, indexes]) => wrapNodeFsMethod(method, indexes));

	const wrapNodeFsPromiseMethod = (name, pathArgIndexes = [0]) => {
		const promises = nodeFs && nodeFs.promises;
		if (!promises) {
			return;
		}
		const original = promises[name];
		const syncMap = {
			readFile: 'readFileSync',
			stat: 'statSync',
			lstat: 'lstatSync',
			realpath: 'realpathSync',
		};
		const syncName = syncMap[name];
		const target =
			syncName && fsSync && typeof fsSync[syncName] === 'function'
				? fsSync[syncName].bind(fsSync)
				: undefined;
		if (typeof original !== 'function' || !target) {
			return;
		}
		promises[name] = async (...methodArgs) => {
			const normalizedArgs = methodArgs.map((arg, index) =>
				pathArgIndexes.includes(index) && shouldNormalizePathString(arg)
					? resolveFsPath(arg)
					: arg
			);
			try {
				console.error('[runner nodeFs.promises]', name, normalizedArgs[0]);
			} catch {}
			return target(...normalizedArgs);
		};
	};

	[
		['readFile', [0]],
		['stat', [0]],
		['lstat', [0]],
		['realpath', [0]],
	].forEach(([method, indexes]) => wrapNodeFsPromiseMethod(method, indexes));

	nodeFs.readdirSync = (pathValue, options) => {
		console.error('[runner] readdirSync request for', pathValue);
		const encoding = normalizeReaddirEncoding(options);
		const targetPath = resolveFsPath(pathValue);
		return fsSync.readdirSync(targetPath, encoding);
	};

	nodeFs.readdir = (pathValue, options, callback) => {
		console.error('[runner] readdir request for', pathValue);
		if (typeof options === 'function') {
			callback = options;
			options = undefined;
		}
		const encoding = normalizeReaddirEncoding(options);
		const targetPath = resolveFsPath(pathValue);
		const run = () => fsSync.readdirSync(targetPath, encoding);
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
		nodeFs.promises.readdir = async (path, options) => {
			const normalizedPath = shouldNormalizePathString(path)
				? resolveFsPath(path)
				: path;
			try {
				console.error('[runner nodeFs.promises]', 'readdir', normalizedPath);
			} catch {}
			return nodeFs.readdirSync(normalizedPath, options);
		};
	}

	const esbuild = require('/esbuild/node_modules/esbuild-wasm/lib/main.js');
	console.error('[runner] required esbuild main');

	await esbuild.initialize({ worker: false });
	console.error('[runner] esbuild initialized successfully');

	${buildBlock}

	const outputFiles = Array.isArray(result.outputFiles)
		? result.outputFiles
		: [];
	const outputText = outputFiles.length > 0 && outputFiles[0]
		? String(outputFiles[0].text || '')
		: '';
	console.error('[runner] raw output', outputText);
const bundleOutputPath = ${bundleOutputPath};
fsSync.writeFileSync(bundleOutputPath, outputText, 'utf8');
console.error('[runner] bundle written to', bundleOutputPath);
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

	const runEsbuildRunner = async (
		entryType: 'virtual' | 'fs',
		entrySetup: (kernel: Kernel) => Promise<void> = createSimpleBlock
	) => {
		await installNpm(kernel);
		await prepareEsbuildEnvironment(kernel);
		await entrySetup(kernel);

		const mainJsPath = '/esbuild/node_modules/esbuild-wasm/lib/main.js';
		const mainJsOriginal = kernel.readFileSync(mainJsPath, 'utf8');
		let mainJsInstrumented = mainJsOriginal;

		if (!mainJsOriginal.includes('[esbuild-channel] afterClose')) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let afterClose = (error) => {',
				`let afterClose = (error) => {
	console.error('[esbuild-channel] afterClose', { reason: closeData.reason, error });`
			);
		}

		if (
			!mainJsInstrumented.includes('[esbuild-main] handleRequest command')
		) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let handleRequest = async (id, request) => {',
				`let handleRequest = async (id, request) => {
\tconsole.error('[esbuild-main] handleRequest command', request && request.command, 'id', id, 'requestKeys:', request && Object.keys(request || {}));`
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
\tconsole.error('[esbuild-main] handlePlugins running with', plugins.length, 'plugins');`
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
	console.error('[esbuild-main] readFromStdout called with', len, 'bytes, type:', chunkType, chunkCtor, 'isUint8Array:', isUint8, 'stdoutUsed before:', stdoutUsed);
    let limit = stdoutUsed + chunk.length;
    if (limit > stdout.length) {
      let swap = new Uint8Array(limit * 2);
      swap.set(stdout);
      stdout = swap;
    }
    try {
      stdout.set(chunk, stdoutUsed);
    } catch (err) {
      console.error('[esbuild-main] ERROR in stdout.set:', err && err.message, 'chunk type:', typeof chunk, chunk.constructor.name);
      throw err;
    }
    stdoutUsed += chunk.length;
    console.error('[esbuild-main] after buffering: stdoutUsed =', stdoutUsed, 'stdout.length =', stdout.length);`
			);
		}

		// Add logging to the packet parsing loop
		if (!mainJsInstrumented.includes('[esbuild-main] parsing loop')) {
			mainJsInstrumented = mainJsInstrumented.replace(
				/let offset = 0;\s*while \(offset \+ 4 <= stdoutUsed\) \{\s*let length = readUInt32LE\(stdout, offset\);/,
				`let offset = 0;
    console.error('[esbuild-main] parsing loop: offset=', offset, 'stdoutUsed=', stdoutUsed);
    while (offset + 4 <= stdoutUsed) {
      console.error('[esbuild-main] parsing loop iteration: offset=', offset);
      let length = readUInt32LE(stdout, offset);
      console.error('[esbuild-main] packet length read:', length, 'need', offset + 4 + length, 'have', stdoutUsed);`
			);
		}

		// Add logging to handleIncomingPacket
		if (
			!mainJsInstrumented.includes('[esbuild-main] handleIncomingPacket')
		) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let handleIncomingPacket = (bytes) => {',
				`let handleIncomingPacket = (bytes) => {
	console.error('[esbuild-main] handleIncomingPacket called with', bytes && bytes.length);`
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
				`console.error('[esbuild-main] setting up stdout listener on', stdout && stdout.constructor && stdout.constructor.name);
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
	console.error('[esbuild-main] writeToStdin called with', bytes && bytes.length, 'bytes');
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
\tconsole.error('[esbuild-main] sendRequest called for command', value && value.command, 'id will be', nextRequestID, 'keys:', value && Object.keys(value), 'plugins:', value && value.plugins ? value.plugins.length : 0, 'payload:', serializedValue);`
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
\t\tconsole.error('[esbuild-main] pending responseCallbacks', Object.keys(responseCallbacks || {}));
\t} catch (err) {
\t\tconsole.error('[esbuild-main] pending responseCallbacks error', err && err.message);
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
	console.error('[esbuild-main] sendResponse called for id', id, 'value keys:', value && Object.keys(value));`
			);
		}

		mainJsInstrumented = mainJsOriginal;
		kernel.writeFileSync(mainJsPath, mainJsInstrumented, 'utf8');

		kernel.mkdirSync('/esbuild/src', { recursive: true });
		if (entrySetup === createSimpleBlock) {
			kernel.writeFileSync(
				'/esbuild/src/index.js',
				encoder.encode(`export const answer = 21 * 2;`),
				null
			);
		}

		const runnerSource = createRunnerSource(entryType);
		console.error(`[test] runner source for ${entryType} (truncated)`);
		console.error(runnerSource);
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
			console.error('[child stdout]', text);
			stdout += text;
		});
		subprocess.stderr?.on('data', (chunk) => {
			const text = chunkToString(chunk);
			console.error('[child stderr]', text);
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
				console.error('[test] wasm dump length', length);
			} else {
				console.error('[test] wasm dump missing');
			}
		} catch (error) {
			console.error('[test] wasm dump read error', error);
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
		await createSimpleImportFixture(kernel);
		await installNpm(kernel);
		console.error('[fixture setup]', {
			hasHelper: kernel.existsSync('/esbuild/src/helper.js'),
			hasIndex: kernel.existsSync('/esbuild/src/index.js'),
		});
		const scriptPath = '/esbuild/bundle.js';
		kernel.writeFileSync(
			scriptPath,
			bundleFixtureSource,
			'utf8'
		);
		// bundle.js fixture uses require(), so mark it as CommonJS
		kernel.writeFileSync(
			'/esbuild/package.json',
			JSON.stringify({ type: 'commonjs', name: 'esbuild-test' }),
			'utf8'
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

		console.log(kernel.readdirSync('/', 'utf8'));
		console.log(kernel.readdirSync('/tmp', 'utf8'));
		console.log(kernel.readFileSync('/tmp/esbuild-bundle-fs.txt', 'utf8'));

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
	it('resolves relative and node_modules requires inside Node loader', async () => {
		await installNpm(kernel);
		kernel.mkdirSync('/project', { recursive: true });
		kernel.writeFileSync(
			'/project/helper.js',
			`module.exports = { value: 42 };`
		);
		kernel.writeFileSync(
			'/project/index.js',
			`const helper = require('./helper');
const pkg = require('pkg');
module.exports = { helper, pkg };`
		);
		kernel.mkdirSync('/project/node_modules/pkg', { recursive: true });
		kernel.writeFileSync(
			'/project/node_modules/pkg/index.js',
			`module.exports = 'pkg-value';`
		);
		kernel.writeFileSync(
			'/project/node_modules/pkg/package.json',
			JSON.stringify({ name: 'pkg', main: 'index.js' }),
			'utf8'
		);
		const resolutionScript = `const fs = require('fs');
const path = require('path');
try {
	console.error('[script] initial cwd', process.cwd());
	process.chdir('/project');
	console.error('[script] after chdir', process.cwd());
	const indexPath = path.resolve(process.cwd(), 'index.js');
	console.error('[script] indexPath', indexPath);
	console.error('[script] exists index', fs.existsSync(indexPath));
	console.error('[script] stat index', fs.statSync(indexPath).size);
const entry = require(indexPath);
console.error('[script] exports index', JSON.stringify(entry));
	process.exit(0);
} catch (error) {
	console.error('[script] failure', error && error.stack ? error.stack : error);
	process.exit(1);
}`;
		kernel.writeFileSync('/test-node-resolve.js', resolutionScript, 'utf8');

		const subprocess = kernel.spawn({
			argv: ['node', '/test-node-resolve.js'],
			env: {
				PATH: '/bin',
				TMPDIR: '/tmp',
				HOME: '/home',
			},
			cwd: '/',
			name: 'node-resolution-check',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		let stdout = '';
		let stderr = '';
		subprocess.stdout?.on('data', (chunk) => {
			stdout += chunkToString(chunk);
		});
		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk);
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		console.error('[node-resolution stdout]', stdout);
		console.error('[node-resolution stderr]', stderr);

		expect(exitCode).toBe(0);
		expect(stdout).toContain('"value":42');
		expect(stderr).toBe('');
	}, 10000);

	it('can bundle via esbuild-wasm using virtual entry', async () => {
		const bundleText = await runEsbuildRunner('virtual');
		expect(bundleText).toContain('answer = 42');
	}, 20000);

	it('can bundle via esbuild-wasm using simple filesystem import', async () => {
		const bundleText = await runEsbuildRunner(
			'fs',
			createSimpleImportFixture
		);
		expect(bundleText).toContain('var answer = 42');
	}, 20000);

	it('can bundle via esbuild-wasm using filesystem node_modules import', async () => {
		const bundleText = await runEsbuildRunner(
			'fs',
			createSimpleNodeModulesFixture
		);
		expect(bundleText).toContain('Hello from node_modules via esbuild');
	}, 20000);

	it('can bundle via esbuild-wasm using filesystem entry', async () => {
		const bundleText = await runEsbuildRunner('fs');
		expect(bundleText).toContain('answer = 42');
	}, 20000);

	it.only('can bundle via esbuild-wasm using bundle fixture script', async () => {
		const { exitCode, stderr, bundleText } = await runBundleFixture();
		console.error('[fixture stderr result]', stderr);
		expect(stderr).toBe('');
		expect(exitCode).toBe(0);
		expect(bundleText).toContain('answer = 42');
	}, 40000);
});
