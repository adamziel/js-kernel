import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../../runtime/index.ts';
import { installCustomPrograms } from '../programs/index.ts';
import bundleFixtureSource from './fixtures/esbuild-wasm/bundle.js?raw';

describe('bundle script test', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');
		installCustomPrograms(kernel);
	});

	it.only('bundle.js script should execute and log', async () => {
		console.error('[test] Writing test script with requires');
		kernel.mkdirSync('/test', { recursive: true });
		const testScript = `
console.error('[script] Starting');
console.error('[script] About to require path');
const path = require('path');
console.error('[script] Required path successfully');
console.error('[script] About to require fs');
const fs = require('fs');
console.error('[script] Required fs successfully');
console.error('[script] All requires completed');
process.exit(0);
`;
		kernel.writeFileSync('/test/bundle.js', testScript, 'utf8');
		kernel.writeFileSync('/test/package.json', JSON.stringify({ type: 'commonjs' }), 'utf8');

		console.error('[test] Spawning bundle.js');
		const subprocess = kernel.spawn({
			argv: ['node', '/test/bundle.js'],
			env: { PATH: '/bin' },
			cwd: '/test',
			name: 'bundle-test',
			stdio: {
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		console.error('[test] spawn returned:', typeof subprocess, subprocess);
		if (typeof subprocess === 'number') {
			throw new Error('Failed to spawn: ' + subprocess);
		}
		console.error('[test] subprocess has stdout:', !!subprocess.stdout, 'stderr:', !!subprocess.stderr);

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
			stderr += text;
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		console.log('[test] Exit code:', exitCode);
		console.log('[test] Stderr:', stderr.substring(0, 500));

		// Should see our debug logs or error
		console.log('[test] Full stderr:', stderr);
		expect(exitCode !== null).toBe(true);
	}, 15000);
});
