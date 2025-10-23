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

describe('esbuild integration', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');
		installCustomPrograms(kernel);
	});

	it('can bundle via esbuild-wasm', async () => {
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

		const runnerSource = `
async function main() {
	const esbuild = require('/esbuild/node_modules/esbuild-wasm/lib/browser.js');
	const fsSync = processController.fsSync;

	const wasmBinary = fsSync.readFileSync('/esbuild/node_modules/esbuild-wasm/esbuild.wasm', 'binary');
	const wasmBytes = Uint8Array.from(wasmBinary, (ch) => ch.charCodeAt(0));
	const wasmModule = await WebAssembly.compile(wasmBytes);
	await esbuild.initialize({ wasmModule });

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
	});

	const outputText = result.outputFiles?.[0]?.text ?? '';
	const base64 = Buffer.from(outputText, 'utf8').toString('base64');
	console.log('BUNDLE:' + base64);
	processController.exit(0);
}

main().catch((error) => {
	processController.stderr.write(String(error));
	processController.exit(1);
});
`;
		kernel.writeFileSync('/test-esbuild.js', runnerSource);
		// Verify node program exists
		const nodeExists = kernel.existsSync('/bin/node');
		console.log('Node program exists:', nodeExists);
		if (nodeExists) {
			const nodeContent = kernel.readFileSync('/bin/node', 'utf8');
			console.log('Node program size:', nodeContent.length);
		}

		console.log('About to spawn node process...');
		let stdout = '';
		let stderr = '';
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

		console.log('Spawned, subprocess type:', typeof subprocess);
		console.log('subprocess:', subprocess);

		expect(typeof subprocess).not.toBe('number');
		if (typeof subprocess === 'number') {
			throw new Error(
				'failed to spawn node program, exit code: ' + subprocess
			);
		}

		subprocess.stdout?.on('data', (chunk) => {
			stdout += chunkToString(chunk);
		});

		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk);
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		console.log('Exit code:', exitCode);
		console.log('Stderr:', stderr);
		console.log('Stdout:', stdout.substring(0, 500));
		console.log('Full Stdout Length:', stdout.length);
		console.log('Full Stdout:', stdout);

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');

		const match = stdout.match(/BUNDLE:([A-Za-z0-9+/=]+)/);
		expect(match).not.toBeNull();
		const raw = atob(match![1]);
		const bundleText = decoder.decode(
			Uint8Array.from(raw, (ch) => ch.charCodeAt(0))
		);
		expect(bundleText).toContain(`// virtual:virtual-entry
var answer = 21 * 2;
`);
	}, 10000);
});
