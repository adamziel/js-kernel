import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../../runtime/index.ts';
import { installCustomPrograms } from '../programs/index.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('minimal esbuild plugin test', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		installCustomPrograms(kernel);
		kernel.mkdirSync('/tmp', { recursive: true });
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.mkdirSync('/home', { recursive: true });
		kernel.writeFileSync('/bin/node', '', { mode: 0o755 });
	});

	it.only('should test esbuild.build() without plugins first', async () => {
		// Setup minimal test environment
		kernel.mkdirSync('/test', { recursive: true });
		kernel.mkdirSync('/test/node_modules/esbuild-wasm', { recursive: true });

		// Create a simple test script that uses esbuild WITHOUT plugins
		const testScript = `
const esbuild = require('/test/node_modules/esbuild-wasm/lib/main.js');

async function test() {
	console.error('[test] Starting esbuild test');

	try {
		console.error('[test] Calling esbuild.initialize()');
		await esbuild.initialize({ worker: false });
		console.error('[test] Initialize successful!');

		console.error('[test] Calling esbuild.build() WITHOUT plugins');
		const result = await esbuild.build({
			stdin: {
				contents: 'export const x = 42;',
				loader: 'js',
			},
			bundle: true,
			write: false,
			format: 'esm',
		});

		console.error('[test] Build successful! Output files:', result.outputFiles?.length);
		if (result.outputFiles && result.outputFiles.length > 0) {
			console.error('[test] Output:', result.outputFiles[0].text);
		}

		return 0;
	} catch (error) {
		console.error('[test] ERROR:', error);
		throw error;
	} finally {
		try {
			await esbuild.stop();
			console.error('[test] esbuild.stop() completed');
		} catch (stopError) {
			console.error('[test] esbuild.stop() failed:', stopError);
		}
	}
}

test()
	.then(() => {
		process.exit(0);
	})
	.catch(() => {
		process.exit(1);
	});
`;

		kernel.writeFileSync('/test/test-no-plugin.js', testScript, 'utf8');
		kernel.writeFileSync(
			'/test/package.json',
			JSON.stringify({ type: 'commonjs' }),
			'utf8'
		);

		// Copy esbuild-wasm if it exists in the fixture location
		// For now, skip if not available
		if (!kernel.existsSync('/esbuild/node_modules/esbuild-wasm')) {
			console.log('Skipping - esbuild-wasm not installed');
			return;
		}

		// Copy esbuild-wasm to test location
		// (In real scenario, this would be installed via npm)

		const subprocess = kernel.spawn({
			argv: ['node', '/test/test-no-plugin.js'],
			env: {
				PATH: '/bin',
				TMPDIR: '/tmp',
				HOME: '/home',
			},
			cwd: '/test',
			name: 'minimal-esbuild-test',
			stdio: {
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		if (typeof subprocess === 'number') {
			throw new Error('Failed to spawn subprocess');
		}

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			const text =
				typeof chunk === 'string'
					? chunk
					: decoder.decode(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
			console.error('[test output]', text);
			stderr += text;
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		console.log('Exit code:', exitCode);
		console.log('Stderr:', stderr);

		expect(exitCode).toBe(0);
		expect(stderr).toContain('Build successful');
	}, 20000);
});
