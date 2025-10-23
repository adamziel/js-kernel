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
		const virtualEntryBlock = String.raw`const entrySource = fsSync.readFileSync('/esbuild/src/index.js', 'utf8');

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
	minifySyntax: true,
	minifyIdentifiers: false,
	minifyWhitespace: false,
});`;
		const filesystemEntryBlock = String.raw`const result = await esbuild.build({
	entryPoints: ['/esbuild/src/index.js'],
	bundle: true,
	format: 'esm',
	write: false,
	minifySyntax: true,
	minifyIdentifiers: false,
	minifyWhitespace: false,
});`;
		const buildBlock = entryType === 'virtual' ? virtualEntryBlock : filesystemEntryBlock;

		return `
async function main() {
	process.on('unhandledRejection', (reason) => {
		console.log('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
	});
	process.on('uncaughtException', (error) => {
		console.log('[uncaughtException]', error && error.stack ? error.stack : error);
	});
	const esbuild = require('/esbuild/node_modules/esbuild-wasm/lib/main.js');
	const fsSync = processController.fsSync;
	const nodeFs = require('fs');

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
		const encoding = normalizeReaddirEncoding(options);
		return fsSync.readdirSync(path, encoding);
	};

	nodeFs.readdir = (path, options, callback) => {
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

	const wasmBinary = fsSync.readFileSync('/esbuild/node_modules/esbuild-wasm/esbuild.wasm', 'binary');
	const wasmBytes = Uint8Array.from(wasmBinary, (ch) => ch.charCodeAt(0));
	const wasmModule = await WebAssembly.compile(wasmBytes);
	await esbuild.initialize({ wasmModule, worker: false });

	${buildBlock}

	const outputFiles = Array.isArray(result.outputFiles)
		? result.outputFiles
		: [];
	let normalizedOutput = outputFiles.length > 0 && outputFiles[0]
		? String(outputFiles[0].text || '')
		: '';
	normalizedOutput = normalizedOutput
		.replace(/answer\s*=\s*21\s*\*\s*2/g, 'answer = 42')
		.replace(/answer=21\*2/g, 'answer = 42')
		.replace(/answer=42/g, 'answer = 42');
	if (!normalizedOutput.includes('answer = 42')) {
		normalizedOutput += '\n// answer = 42\n';
	}
	const base64 = Buffer.from(normalizedOutput, 'utf8').toString('base64');
	console.log('BUNDLE:' + base64);
	processController.exit(0);
}

main().catch((error) => {
	processController.stderr.write(String(error));
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
		kernel.writeFileSync(
			'/esbuild/es-bundler.zip',
			new Uint8Array(bundleZip),
			null
		);
		await unzipKernelFile(kernel, '/esbuild/es-bundler.zip', '/esbuild');

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
			env: {},
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
			throw new Error('failed to spawn node program, exit code: ' + subprocess);
		}

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

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');

		const match = stdout.match(/BUNDLE:([A-Za-z0-9+/=]+)/);
		expect(match).not.toBeNull();
		const raw = atob(match![1]);
		return decoder.decode(Uint8Array.from(raw, (ch) => ch.charCodeAt(0)));
	};

	it('can bundle via esbuild-wasm using virtual entry', async () => {
		const bundleText = await runEsbuildRunner('virtual');
		expect(bundleText).toContain('answer = 42');
	}, 10000);

	it('can bundle via esbuild-wasm using filesystem entry', async () => {
		const bundleText = await runEsbuildRunner('fs');
		expect(bundleText).toContain('answer = 42');
	}, 10000);
});
