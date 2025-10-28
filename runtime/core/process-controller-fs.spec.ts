import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from './kernel.ts';

const decoder = new TextDecoder();

const chunkToString = (chunk: string | Uint8Array) =>
	typeof chunk === 'string' ? chunk : decoder.decode(chunk);

describe('processController filesystem access', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');
	});

	it('supports async fs operations via processController.fs', async () => {
		const programSource = `
			export default async function main(processController) {
				await processController.fs.writeFile('/async-output.txt', 'from async fs', {
					encoding: 'utf8',
				});
				const content = await processController.fs.readFile('/async-output.txt', 'utf8');
				processController.stdout.write(content);
				processController.exit(0);
			}
		`;
		kernel.writeFileSync('/bin/fs-write-async', programSource, {
			mode: 0o755,
		});

		const subprocess = kernel.spawn({
			argv: ['fs-write-async'],
			env: {},
			cwd: '/',
			name: 'fs-async',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		expect(typeof subprocess).not.toBe('number');
		if (typeof subprocess === 'number') {
			throw new Error('spawn returned exit code');
		}

		let stdout = '';
		subprocess.stdout?.on('data', (chunk) => {
			stdout += chunkToString(chunk);
		});

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk);
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');
		expect(stdout).toContain('from async fs');
		expect(kernel.readFileSync('/async-output.txt', 'utf8')).toBe(
			'from async fs'
		);
	});

	it('supports sync fs operations via processController.fsSync', async () => {
		const programSource = `
			export default async function main(processController) {
				processController.fsSync.writeFileSync('/sync-output.txt', 'from sync fs', 'utf8');
				const content = processController.fsSync.readFileSync('/sync-output.txt', 'utf8');
				processController.stdout.write(content);
				processController.exit(0);
			}
		`;
		kernel.writeFileSync('/bin/fs-write-sync', programSource, {
			mode: 0o755,
		});

		const subprocess = kernel.spawn({
			argv: ['fs-write-sync'],
			env: {},
			cwd: '/',
			name: 'fs-sync',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		expect(typeof subprocess).not.toBe('number');
		if (typeof subprocess === 'number') {
			throw new Error('spawn returned exit code');
		}

		let stdout = '';
		subprocess.stdout?.on('data', (chunk) => {
			stdout += chunkToString(chunk);
		});

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk);
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');
		expect(stdout).toContain('from sync fs');
		expect(kernel.readFileSync('/sync-output.txt', 'utf8')).toBe(
			'from sync fs'
		);
	});

	it('async operations do not block - code continues executing', async () => {
		const programSource = `
			export default async function main(processController) {
				// Start async write but don't await
				const writePromise = processController.fs.writeFile('/non-blocking.txt', 'data', 'utf8');

				// This should execute immediately without waiting
				processController.stdout.write('continued');

				// Confirm the file does not exist yet
				try {
					processController.fsSync.readFileSync('/non-blocking.txt', 'utf8');
					processController.stdout.write('ERROR: file should not exist yet');
				} catch (err) {
					if (err.code === 'ENOENT') {
						processController.stdout.write('SUCCESS: file does not exist yet');
					}
				}

				// Now wait for the write to complete
				await writePromise;
				processController.exit(0);
			}
		`;
		kernel.writeFileSync('/bin/non-blocking-test', programSource, {
			mode: 0o755,
		});

		const subprocess = kernel.spawn({
			argv: ['non-blocking-test'],
			env: {},
			cwd: '/',
			name: 'non-blocking',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		expect(typeof subprocess).not.toBe('number');
		if (typeof subprocess === 'number') {
			throw new Error('spawn returned exit code');
		}

		let stdout = '';
		subprocess.stdout?.on('data', (chunk) => {
			stdout += chunkToString(chunk);
		});

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk);
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');
		expect(stdout).toContain('continued');
		expect(kernel.readFileSync('/non-blocking.txt', 'utf8')).toBe('data');
	});

	it('multiple async operations run concurrently', async () => {
		const programSource = `
			export default async function main(processController) {
				// Start 5 async writes concurrently
				const promises = [];
				for (let i = 0; i < 5; i++) {
					promises.push(
						processController.fs.writeFile(\`/concurrent-\${i}.txt\`, \`data-\${i}\`, 'utf8')
					);
				}

				// Wait for all to complete
				await Promise.all(promises);

				// Verify all files were written
				for (let i = 0; i < 5; i++) {
					const content = await processController.fs.readFile(\`/concurrent-\${i}.txt\`, 'utf8');
					processController.stdout.write(content + ',');
				}
				processController.exit(0);
			}
		`;
		kernel.writeFileSync('/bin/concurrent-test', programSource, {
			mode: 0o755,
		});

		const subprocess = kernel.spawn({
			argv: ['concurrent-test'],
			env: {},
			cwd: '/',
			name: 'concurrent',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		expect(typeof subprocess).not.toBe('number');
		if (typeof subprocess === 'number') {
			throw new Error('spawn returned exit code');
		}

		let stdout = '';
		subprocess.stdout?.on('data', (chunk) => {
			stdout += chunkToString(chunk);
		});

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk);
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');
		expect(stdout).toContain('data-0');
		expect(stdout).toContain('data-1');
		expect(stdout).toContain('data-2');
		expect(stdout).toContain('data-3');
		expect(stdout).toContain('data-4');

		// Verify files exist
		for (let i = 0; i < 5; i++) {
			expect(kernel.readFileSync(`/concurrent-${i}.txt`, 'utf8')).toBe(
				`data-${i}`
			);
		}
	});

	it('sync operations block as expected', async () => {
		const programSource = `
			export default async function main(processController) {
				let order = '';

				// Sync write should block
				processController.fsSync.writeFileSync('/sync-block.txt', 'data', 'utf8');
				order += 'write,';

				// This line only executes after write completes
				const content = processController.fsSync.readFileSync('/sync-block.txt', 'utf8');
				order += 'read,';

				processController.stdout.write(order + content);
				processController.exit(0);
			}
		`;
		kernel.writeFileSync('/bin/sync-block-test', programSource, {
			mode: 0o755,
		});

		const subprocess = kernel.spawn({
			argv: ['sync-block-test'],
			env: {},
			cwd: '/',
			name: 'sync-block',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		expect(typeof subprocess).not.toBe('number');
		if (typeof subprocess === 'number') {
			throw new Error('spawn returned exit code');
		}

		let stdout = '';
		subprocess.stdout?.on('data', (chunk) => {
			stdout += chunkToString(chunk);
		});

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk);
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');
		expect(stdout).toContain('write,read,data');
	});

	it('async operations do not execute for sync calls (no double execution)', async () => {
		const programSource = `
			export default async function main(processController) {
				// This test verifies that sync calls don't trigger async operations
				// which would cause double-close and EBADF errors

				// Write a test file
				processController.fsSync.writeFileSync('/double-exec-test.txt', 'test data', 'utf8');

				// Open with sync
				const fd = processController.fsSync.openSync('/double-exec-test.txt', 'r');

				// Close with sync - should ONLY close once
				processController.fsSync.closeSync(fd);

				// Wait a bit to ensure no async close happens
				await new Promise(resolve => setTimeout(resolve, 50));

				// Try to use the fd - should get EBADF (expected behavior)
				try {
					processController.fsSync.fstatSync(fd);
					processController.stdout.write('ERROR: fd still valid, should be closed');
				} catch (err) {
					if (err.code === 'EBADF') {
						processController.stdout.write('SUCCESS: fd properly closed once');
					} else {
						processController.stdout.write('ERROR: unexpected error ' + err.message);
					}
				}

				processController.exit(0);
			}
		`;
		kernel.writeFileSync('/bin/double-exec-test', programSource, {
			mode: 0o755,
		});

		const subprocess = kernel.spawn({
			argv: ['double-exec-test'],
			env: {},
			cwd: '/',
			name: 'double-exec',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		expect(typeof subprocess).not.toBe('number');
		if (typeof subprocess === 'number') {
			throw new Error('spawn returned exit code');
		}

		let stdout = '';
		subprocess.stdout?.on('data', (chunk) => {
			stdout += chunkToString(chunk);
		});

		let stderr = '';
		subprocess.stderr?.on('data', (chunk) => {
			stderr += chunkToString(chunk);
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');
		expect(stdout).toContain('SUCCESS: fd properly closed once');
	});
});
