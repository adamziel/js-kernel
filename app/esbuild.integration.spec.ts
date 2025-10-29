import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../runtime/index.ts';
import { installCustomPrograms } from './programs/index.ts';
import { ZipReader, BlobReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import esBundlerZipUrl from './programs/node-loader/es-bundler.zip?url';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

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

const virtualEntryPlugin = {
	name: 'virtual-entry',
	setup(build) {
		build.onResolve({ filter: /^virtual-entry$/ }, () => ({
			path: 'virtual-entry',
			namespace: 'virtual',
		}));

		build.onLoad({ filter: /^virtual-entry$/, namespace: 'virtual' }, () => ({
			contents: entrySource,
			loader: 'js',
			resolveDir: '/esbuild/src',
		}));
	},
};

console.log('[runner] about to call esbuild.build()');
const result = await esbuild.build({
	entryPoints: ['virtual-entry'],
	bundle: true,
	format: 'esm',
	write: false,
	plugins: [virtualEntryPlugin],
});
console.log('[runner] esbuild.build() completed');`;
		const filesystemEntryBlock = String.raw`console.log('[runner] about to call esbuild.build() with fs entry');
const result = await esbuild.build({
	entryPoints: ['/esbuild/src/index.js'],
	bundle: true,
	format: 'esm',
	write: false,
});
console.log('[runner] esbuild.build() with fs entry completed');`;
		const buildBlock =
			entryType === 'virtual' ? virtualEntryBlock : filesystemEntryBlock;

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
	const base64 = Buffer.from(outputText, 'utf8').toString('base64');
	console.log('BUNDLE:' + base64);
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

		// Add logging to readFromStdout to see if it's being called and buffer status
		if (!mainJsInstrumented.includes('[esbuild-main] readFromStdout called')) {
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
		if (!mainJsInstrumented.includes('[esbuild-main] handleIncomingPacket')) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let handleIncomingPacket = (bytes) => {',
				`let handleIncomingPacket = (bytes) => {
	console.error('[esbuild-main] handleIncomingPacket called with', bytes && bytes.length);`
			);
		}

		// Add logging to stdout.on setup
		if (!mainJsInstrumented.includes('[esbuild-main] setting up stdout listener')) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'stdout.on("data", readFromStdout);',
				`console.error('[esbuild-main] setting up stdout listener on', stdout && stdout.constructor && stdout.constructor.name);
stdout.on("data", readFromStdout);`
			);
		}

		// Add logging to stdin writes to see if responses are being sent
		if (!mainJsInstrumented.includes('[esbuild-main] writeToStdin called')) {
			mainJsInstrumented = mainJsInstrumented.replace(
				/streamIn\.writeToStdin\(/g,
				`(function(bytes) {
	console.error('[esbuild-main] writeToStdin called with', bytes && bytes.length, 'bytes');
	return streamIn.writeToStdin(bytes);
})(`
			);
		}

		// Add logging to sendResponse to see if responses are attempted
		if (!mainJsInstrumented.includes('[esbuild-main] sendResponse called')) {
			mainJsInstrumented = mainJsInstrumented.replace(
				'let sendResponse = (id, value) => {',
				`let sendResponse = (id, value) => {
	console.error('[esbuild-main] sendResponse called for id', id, 'value keys:', value && Object.keys(value));`
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
				stdin: 'ignore',
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

		const match = stdout.match(/BUNDLE:([A-Za-z0-9+/=]+)/);
		expect(match).not.toBeNull();
		const raw = atob(match![1]);
		return decoder.decode(Uint8Array.from(raw, (ch) => ch.charCodeAt(0)));
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
	}, 120000);

	it('can bundle via esbuild-wasm using filesystem entry', async () => {
		const bundleText = await runEsbuildRunner('fs');
		expect(bundleText).toContain('answer = 42');
	}, 120000);
});
