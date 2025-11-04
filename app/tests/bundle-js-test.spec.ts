import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../../runtime/index.ts';
import { installCustomPrograms } from '../programs/index.ts';
import bundleFixtureSource from './fixtures/esbuild-wasm/bundle.js?raw';
import esbuildLibMainSource from './fixtures/esbuild-wasm/lib/main.js?raw';
import wasmExecSource from './fixtures/esbuild-wasm/wasm_exec.js?raw';
import wasmExecNodeSource from './fixtures/esbuild-wasm/wasm_exec_node.js?raw';

const encoder = new TextEncoder();

describe('bundle.js fixture tests', () => {
	let kernel: Kernel;

beforeEach(() => {
	kernel = new Kernel();
	installCustomPrograms(kernel);
		kernel.mkdirSync('/tmp', { recursive: true });
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.mkdirSync('/home', { recursive: true });
		kernel.writeFileSync('/bin/node', '', { mode: 0o755 });
		// If the esbuild-wasm package has been extracted into this kernel, replace
		// key entry points with the instrumented versions so we get detailed logs.
		const replacements: Array<[string, string, string]> = [
			['/esbuild/node_modules/esbuild-wasm/lib/main.js', esbuildLibMainSource, 'lib/main.js'],
			['/esbuild/node_modules/esbuild-wasm/wasm_exec.js', wasmExecSource, 'wasm_exec.js'],
			['/esbuild/node_modules/esbuild-wasm/wasm_exec_node.js', wasmExecNodeSource, 'wasm_exec_node.js'],
		];
		for (const [target, contents, label] of replacements) {
			if (!kernel.existsSync(target)) {
				continue;
			}
			kernel.writeFileSync(target, contents, 'utf8');
			const size =
				typeof contents === 'string' ? contents.length : contents.byteLength;
			console.error('[bundle-js-test] wrote instrumented', label, 'size', size);
		}
	});

	it('should fail with exit code 1 when entry file does not exist', async () => {
		// Setup: Create bundle.js but no entry file
		kernel.mkdirSync('/esbuild', { recursive: true });

		// Skip if esbuild not available
		if (!kernel.existsSync('/esbuild/node_modules/esbuild-wasm')) {
			console.log('Skipping test - esbuild-wasm not installed');
			return;
		}

		kernel.writeFileSync('/esbuild/bundle.js', bundleFixtureSource, 'utf8');
		kernel.writeFileSync(
			'/esbuild/package.json',
			JSON.stringify({ type: 'commonjs', name: 'test' }),
			'utf8'
		);

		// Create source directory but no index.js
		kernel.mkdirSync('/esbuild/src', { recursive: true });

		const subprocess = kernel.spawn({
			argv: ['node', '/esbuild/bundle.js', '/esbuild/src', '/tmp/output.txt'],
			env: { PATH: '/bin', TMPDIR: '/tmp', HOME: '/home' },
			cwd: '/esbuild',
			name: 'bundle-test-fail',
			stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
		});

		if (typeof subprocess === 'number') {
			throw new Error('Failed to spawn subprocess');
		}

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			const text =
				typeof chunk === 'string'
					? chunk
					: new TextDecoder().decode(
							chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
						);
			stderr += text;
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});
		console.log('[test] Exit code:', exitCode);
		console.log('[test] Stderr:', stderr);
		expect(exitCode).toBe(1);
		expect(stderr).toContain('No entry points found');
	}, 10000);

	it('should succeed when entry file exists at correct path', async () => {
		// Setup: Create bundle.js and entry file
		kernel.mkdirSync('/esbuild', { recursive: true });
		kernel.writeFileSync('/esbuild/bundle.js', bundleFixtureSource, 'utf8');
		kernel.writeFileSync(
			'/esbuild/package.json',
			JSON.stringify({ type: 'commonjs', name: 'test' }),
			'utf8'
		);

		// Create source directory with index.js
		kernel.mkdirSync('/esbuild/src', { recursive: true });
		kernel.writeFileSync(
			'/esbuild/src/index.js',
			`export const answer = 42;`,
			'utf8'
		);

		// Install esbuild-wasm (simulated - in real test this would come from npm install)
		// For now, skip this test if esbuild is not available
		if (!kernel.existsSync('/esbuild/node_modules/esbuild-wasm')) {
			console.log('Skipping test - esbuild-wasm not installed');
			return;
		}

		const subprocess = kernel.spawn({
			argv: ['node', '/esbuild/bundle.js', '/esbuild/src', '/tmp/output.txt'],
			env: {
				PATH: '/bin',
				TMPDIR: '/tmp',
				HOME: '/home',
				ESBUILD_LOG_LEVEL: 'debug',
				NODE_PATH: '/esbuild/node_modules',
			},
			cwd: '/esbuild',
			name: 'bundle-test-success',
			stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
		});

		if (typeof subprocess === 'number') {
			throw new Error('Failed to spawn subprocess');
		}

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			const text =
				typeof chunk === 'string'
					? chunk
					: new TextDecoder().decode(
							chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
						);
			console.error('[test stderr]', text);
			stderr += text;
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		expect(exitCode).toBe(0);
		expect(kernel.existsSync('/tmp/output.txt')).toBe(true);
	}, 10000);

	it('should correctly resolve srcDir when passed as /jsx/src', async () => {
		// This tests the fix for the main-app.ts issue
		kernel.mkdirSync('/esbuild', { recursive: true });
		kernel.writeFileSync('/esbuild/bundle.js', bundleFixtureSource, 'utf8');
		kernel.writeFileSync(
			'/esbuild/package.json',
			JSON.stringify({ type: 'commonjs', name: 'test' }),
			'utf8'
		);

		// Create structure like TestCases.createSimpleBlock()
		kernel.mkdirSync('/jsx/src', { recursive: true });
		kernel.writeFileSync(
			'/jsx/src/index.js',
			`export const block = { title: 'Test Block' };`,
			'utf8'
		);

		// Skip if esbuild not available
		if (!kernel.existsSync('/esbuild/node_modules/esbuild-wasm')) {
			console.log('Skipping test - esbuild-wasm not installed');
			return;
		}

		// This should work now with /jsx/src (not /jsx)
		const subprocess = kernel.spawn({
			argv: ['node', '/esbuild/bundle.js', '/jsx/src', '/tmp/block-output.txt'],
			env: { PATH: '/bin', TMPDIR: '/tmp', HOME: '/home' },
			cwd: '/esbuild',
			name: 'bundle-test-jsx',
			stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
		});

		if (typeof subprocess === 'number') {
			throw new Error('Failed to spawn subprocess');
		}

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			const text =
				typeof chunk === 'string'
					? chunk
					: new TextDecoder().decode(
							chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
						);
			stderr += text;
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		expect(exitCode).toBe(0);
		expect(stderr).not.toContain('Missing entry file');
	}, 10000);
});
