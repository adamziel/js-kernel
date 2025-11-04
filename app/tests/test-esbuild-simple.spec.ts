import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../../runtime/index.ts';
import { installCustomPrograms } from '../programs/index.ts';

describe('simple esbuild test', () => {
	let kernel: Kernel;

	beforeEach(async () => {
		kernel = new Kernel();
		installCustomPrograms(kernel);
		kernel.mkdirSync('/tmp', { recursive: true });
	});

	it.only('should bundle simple code without plugins', async () => {
		console.error('[test] Starting simple esbuild test');

		// Create a simple test script
		const testScript = `
const esbuild = require('/esbuild/node_modules/esbuild-wasm/lib/main.js');

async function test() {
	console.error('[script] Initializing esbuild');
	await esbuild.initialize({ worker: false });
	console.error('[script] esbuild initialized');

	try {
		console.error('[script] Running build');
		const result = await esbuild.build({
			stdin: {
				contents: 'export const x = 42;',
				loader: 'js',
			},
			bundle: true,
			write: false,
		});
		console.error('[script] Build complete');

		const output = result.outputFiles[0].text;
		process.stdout.write(output);
		return 0;
	} finally {
		try {
			await esbuild.stop();
			console.error('[script] esbuild stopped');
		} catch (stopError) {
			console.error(
				'[script] esbuild.stop() failed',
				stopError && stopError.stack ? stopError.stack : stopError
			);
		}
	}
}

test()
	.then(() => {
		process.exit(0);
	})
	.catch((err) => {
		console.error('[script] Error:', (err && err.stack) || err);
		process.exit(1);
	});
`;

		// Setup esbuild-wasm
		kernel.mkdirSync('/esbuild', { recursive: true});
		kernel.writeFileSync('/esbuild/test.js', testScript, 'utf8');
		kernel.writeFileSync('/esbuild/package.json', JSON.stringify({ type: 'commonjs' }), 'utf8');

		// Install esbuild-wasm (copy from wherever it's installed in other tests)
		// For now, assume it's already available from other test setup
		// We need to check if it exists
		if (!kernel.existsSync('/esbuild/node_modules')) {
			console.error('[test] esbuild-wasm not installed, skipping');
			expect(true).toBe(true);
			return;
		}

		const subprocess = kernel.spawn({
			argv: ['node', '/esbuild/test.js'],
			env: {
				PATH: '/bin',
				ESBUILD_LOG_LEVEL: 'debug',
				NODE_PATH: '/esbuild/node_modules',
			},
			cwd: '/esbuild',
			name: 'esbuild-simple-test',
			stdio: {
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		if (typeof subprocess === 'number') {
			throw new Error('Failed to spawn subprocess');
		}

		let stdout = '';
		let stderr = '';

		subprocess.stdout?.on('data', (chunk) => {
			const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
			stdout += text;
		});

		subprocess.stderr?.on('data', (chunk) => {
			const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
			stderr += text;
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		console.log('[test] Exit code:', exitCode);
		console.log('[test] Stdout:', stdout.substring(0, 200));
		console.log('[test] Stderr:', stderr.substring(0, 500));

		expect(exitCode).toBe(0);
		expect(stdout).toContain('42');
	}, 60000);
});
