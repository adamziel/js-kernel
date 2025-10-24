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

const result = await esbuild.build({
	entryPoints: ['virtual-entry'],
	bundle: true,
	format: 'esm',
	write: false,
	plugins: [virtualEntryPlugin],
});`;
		const filesystemEntryBlock = String.raw`const result = await esbuild.build({
	entryPoints: ['/esbuild/src/index.js'],
	bundle: true,
	format: 'esm',
	write: false,
});`;
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

		const esbuildBinPath = '/esbuild/node_modules/esbuild-wasm/bin/esbuild';
		const originalEsbuildBin = kernel.readFileSync(esbuildBinPath, 'utf8');
		const envFilterBlock = `for (let key in process.env) {
  if (esbuildUsedEnvVars.indexOf(key) < 0) {
    delete process.env[key]
  }
}

`;
		const instrumentedEsbuildBin = originalEsbuildBin
			.replace(
				"const module_ = require('module');",
				`process.on('exit', (code) => {
	console.error('[esbuild-bin] exit', code);
});
process.on('uncaughtException', (error) => {
	console.error('[esbuild-bin] uncaughtException', error && error.stack ? error.stack : error);
});
process.on('unhandledRejection', (reason) => {
	console.error('[esbuild-bin] unhandledRejection', reason && reason.stack ? reason.stack : reason);
});
const originalProcessExit = process.exit.bind(process);
process.exit = (code = 0) => {
	const trace = new Error('process.exit trace');
	console.error('[esbuild-bin] process.exit', code, trace.stack || trace.message);
	return originalProcessExit(code);
};
const module_ = require('module');`
			)
			.replace(
				envFilterBlock,
				'// Disabled env filtering for kernel diagnostics\n'
			);
		kernel.writeFileSync(
			esbuildBinPath,
			encoder.encode(instrumentedEsbuildBin)
		);

		const wasmExecPath =
			'/esbuild/node_modules/esbuild-wasm/wasm_exec_node.js';
		const originalWasmExec = kernel.readFileSync(wasmExecPath, 'utf8');
		const instrumentedWasmExec = originalWasmExec
			.replace(
				'const go = new Go();',
				`const go = new Go();
console.error('[wasm-exec] argv', JSON.stringify(process.argv));
console.error('[wasm-exec] env keys', Object.keys(process.env));
const __originalProcessExitForWasm = process.exit.bind(process);
process.exit = (code = 0) => {
	const trace = new Error('process.exit trace');
	console.error('[wasm-exec] process.exit', code, trace.stack || trace.message);
	return __originalProcessExitForWasm(code);
};
const originalRun = go.run.bind(go);
go.run = async (instance) => {
	console.error('[wasm-exec] go.run start');
	try {
		const result = await originalRun(instance);
		console.error('[wasm-exec] go.run resolved', go.exitCode);
		return result;
	} catch (err) {
	console.error('[wasm-exec] go.run error', err && err.stack ? err.stack : err);
	throw err;
}
};
process.on('exit', (code) => {
	const trace = new Error('process.exit trace (listener)');
	console.error('[wasm-exec] process exit listener', code, trace.stack || trace.message);
});
process.on('uncaughtException', (error) => {
	console.error('[wasm-exec] uncaughtException', error && error.stack ? error.stack : error);
});
process.on('unhandledRejection', (reason) => {
	console.error('[wasm-exec] unhandledRejection', reason && reason.stack ? reason.stack : reason);
});
setTimeout(() => {
	console.error('[wasm-exec] sanity timer fired', Date.now());
}, 250);`
			)
			.replace(
				'this._inst.exports.run(argc, argv);',
				`console.error('[wasm-exec] Go.run about to call exports.run', { argc, argvCount: argvPtrs.length });
			this._inst.exports.run(argc, argv);
			console.error('[wasm-exec] Go.run returned from exports.run', { exited: this.exited, pendingEvent: this._pendingEvent ? true : false, scheduledTimeouts: this._scheduledTimeouts?.size });`
			)
			.replace(
				'this._inst.exports.resume();',
				`console.error('[wasm-exec] Go._resume entering', { exited: this.exited, pendingEvent: this._pendingEvent ? true : false, scheduledTimeouts: this._scheduledTimeouts?.size });
			this._inst.exports.resume();
			console.error('[wasm-exec] Go._resume exited', { exited: this.exited, pendingEvent: this._pendingEvent ? true : false, scheduledTimeouts: this._scheduledTimeouts?.size });`
			)
			.replace(
				'go.exit = process.exit;',
				'// go.exit instrumentation handled via process.exit override\n'
			);
		kernel.writeFileSync(
			wasmExecPath,
			encoder.encode(instrumentedWasmExec)
		);
		const wasmExecLibPath =
			'/esbuild/node_modules/esbuild-wasm/wasm_exec.js';
		const originalWasmExecLib = kernel.readFileSync(
			wasmExecLibPath,
			'utf8'
		);
		const instrumentedWasmExecLib = originalWasmExecLib
			.replace(
				'this._inst.exports.run(argc, argv);',
				`const pendingBefore = this._pendingEvent ? { id: this._pendingEvent.id ?? null, argTypes: Array.from(this._pendingEvent.args ?? []).map((arg) => typeof arg).slice(0, 4) } : null;
\t\t\tconsole.error('[wasm-exec] Go.run about to call exports.run', { argc, argvCount: argvPtrs.length, pendingBefore, scheduledTimeouts: this._scheduledTimeouts?.size ?? 0 });
\t\t\tthis._inst.exports.run(argc, argv);
\t\t\tconst pendingAfter = this._pendingEvent ? { id: this._pendingEvent.id ?? null, argTypes: Array.from(this._pendingEvent.args ?? []).map((arg) => typeof arg).slice(0, 4) } : null;
\t\t\tconsole.error('[wasm-exec] Go.run returned from exports.run', { exited: this.exited, pendingAfter, scheduledTimeouts: this._scheduledTimeouts?.size ?? 0 });`
			)
			.replace(
				'this._inst.exports.resume();',
				`const pendingBefore = this._pendingEvent ? { id: this._pendingEvent.id ?? null, argTypes: Array.from(this._pendingEvent.args ?? []).map((arg) => typeof arg).slice(0, 4) } : null;
\t\t\tconsole.error('[wasm-exec] Go._resume entering', { exited: this.exited, pendingBefore, scheduledTimeouts: this._scheduledTimeouts?.size ?? 0 });
\t\t\tthis._inst.exports.resume();
\t\t\tconst pendingAfter = this._pendingEvent ? { id: this._pendingEvent.id ?? null, argTypes: Array.from(this._pendingEvent.args ?? []).map((arg) => typeof arg).slice(0, 4) } : null;
\t\t\tconsole.error('[wasm-exec] Go._resume exited', { exited: this.exited, pendingAfter, scheduledTimeouts: this._scheduledTimeouts?.size ?? 0 });`
			)
			.replace(
				'const id = this._nextCallbackTimeoutID;',
				`const id = this._nextCallbackTimeoutID;
\t\t\t\tconst delay = getInt64(sp + 8);
\t\t\t\tconsole.error('[wasm-exec] scheduleTimeoutEvent', { id, delay, pendingEvent: this._pendingEvent ? { id: this._pendingEvent.id ?? null } : null, scheduledTimeouts: this._scheduledTimeouts?.size ?? 0 });`
			)
			.replace(
				'this._scheduledTimeouts.set(id, setTimeout(',
				`this._scheduledTimeouts.set(id, setTimeout(`
			)
			.replace(
				'() => {\n\t\t\t\t\t\t\t\tthis._resume();',
				`() => {
\t\t\t\t\t\tconsole.error('[wasm-exec] scheduleTimeoutEvent firing', { id, pendingEvent: this._pendingEvent ? { id: this._pendingEvent.id ?? null } : null, scheduledTimeouts: this._scheduledTimeouts?.size ?? 0 });
\t\t\t\t\t\tthis._resume();`
			)
			.replace('\t\t\t\t\t\t\tgetInt64(sp + 8),', '\t\t\t\t\t\t\tdelay,')
			.replace(
				'const id = this.mem.getInt32(sp + 8, true);',
				`const id = this.mem.getInt32(sp + 8, true);
\t\t\t\tconsole.error('[wasm-exec] clearTimeoutEvent', { id, scheduled: this._scheduledTimeouts?.has(id) ?? false });`
			);
		kernel.writeFileSync(
			wasmExecLibPath,
			encoder.encode(instrumentedWasmExecLib)
		);
		const mainJsPath = '/esbuild/node_modules/esbuild-wasm/lib/main.js';
		const mainJsOriginal = kernel.readFileSync(mainJsPath, 'utf8');
		if (!mainJsOriginal.includes('[esbuild-channel] afterClose')) {
			const mainJsInstrumented = mainJsOriginal.replace(
				'let afterClose = (error) => {',
				`let afterClose = (error) => {
	console.error('[esbuild-channel] afterClose', { reason: closeData.reason, error });`
			);
			kernel.writeFileSync(mainJsPath, mainJsInstrumented);
		}

		kernel.mkdirSync('/esbuild/src', { recursive: true });
		kernel.writeFileSync(
			'/esbuild/src/index.js',
			encoder.encode(`export const answer = 21 * 2;`)
		);

		const runnerSource = createRunnerSource(entryType);
		console.log(`[test] runner source for ${entryType}:`);
		console.log(runnerSource);
		kernel.writeFileSync('/test-esbuild.js', runnerSource);

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

	it.only('can bundle via esbuild-wasm using virtual entry', async () => {
		const bundleText = await runEsbuildRunner('virtual');
		expect(bundleText).toContain('answer = 42');
	}, 25000);

	it('can bundle via esbuild-wasm using filesystem entry', async () => {
		const bundleText = await runEsbuildRunner('fs');
		expect(bundleText).toContain('answer = 42');
	}, 10000);
});
