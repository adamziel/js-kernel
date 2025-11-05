import { describe, it, expect } from 'vitest';
import { Kernel } from '../core/kernel.ts';
import { installBusybox } from './index.ts';

const decoder = new TextDecoder();

const chunkToString = (chunk: string | Uint8Array): string =>
	typeof chunk === 'string' ? chunk : decoder.decode(chunk);

const waitFor = async (
	predicate: () => boolean,
	timeout = 5000,
	interval = 25
) => {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeout) {
			throw new Error('Timed out waiting for condition');
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
};

describe('tty-shell integration', () => {
	it(
		'executes nested command based on interactive input',
		async () => {
			const kernel = new Kernel();
			installBusybox(kernel);
			kernel.setEnv('PATH', '/bin');

			kernel.writeFileSync(
				'/bin/argv-dump',
				`
					export default async function main(processController) {
						const payload = JSON.stringify({
							argv: processController.argv().slice(1),
						});
						processController.stdout.write(payload + '\\n');
						return 0;
					}
				`,
				{ mode: 0o755 }
			);

			const subprocess = kernel.spawn({
				argv: ['tty-shell'],
				env: {},
				cwd: '/',
				name: 'tty-shell',
				stdio: {
					stdin: 'pipe',
					stdout: 'pipe',
					stderr: 'pipe',
				},
			});

			expect(typeof subprocess).not.toBe('number');
			if (typeof subprocess === 'number') {
				throw new Error('tty-shell spawn failed');
			}

			let stdout = '';
			subprocess.stdout?.on('data', (chunk) => {
				stdout += chunkToString(chunk);
			});

			let stderr = '';
			subprocess.stderr?.on('data', (chunk) => {
				stderr += chunkToString(chunk);
			});

			await waitFor(() => stdout.includes('$ '));

			subprocess.stdin?.write('argv-dump alpha beta\n');

			await waitFor(() =>
				stdout.includes('{"argv":["alpha","beta"]}')
			);

			expect(stderr).toBe('');

			subprocess.stdin?.write('\u0004');

			const exitCode = await new Promise<number>((resolve) => {
				subprocess.onExit((code) => resolve(code ?? 0));
			});

			expect(exitCode).toBe(0);
		},
		20000
	);

	it(
		'updates working directory using cd',
		async () => {
			const kernel = new Kernel();
			installBusybox(kernel);
			kernel.setEnv('PATH', '/bin');
			kernel.mkdirSync('/workspace/project', { recursive: true });

			const subprocess = kernel.spawn({
				argv: ['tty-shell'],
				env: {},
				cwd: '/',
				name: 'tty-shell',
				stdio: {
					stdin: 'pipe',
					stdout: 'pipe',
					stderr: 'pipe',
				},
			});

			expect(typeof subprocess).not.toBe('number');
			if (typeof subprocess === 'number') {
				throw new Error('tty-shell spawn failed');
			}

			let stdout = '';
			subprocess.stdout?.on('data', (chunk) => {
				stdout += chunkToString(chunk);
			});

			let stderr = '';
			subprocess.stderr?.on('data', (chunk) => {
				stderr += chunkToString(chunk);
			});

			await waitFor(() => stdout.includes('$ '));

			subprocess.stdin?.write('cd /workspace\n');
			subprocess.stdin?.write('pwd\n');

			await waitFor(() => stdout.includes('/workspace\n'));

			subprocess.stdin?.write('cd project\n');
			subprocess.stdin?.write('pwd\n');

			await waitFor(() => stdout.includes('/workspace/project\n'));

			expect(stderr).toBe('');

			subprocess.stdin?.write('\u0004');

			const exitCode = await new Promise<number>((resolve) => {
				subprocess.onExit((code) => resolve(code ?? 0));
			});

			expect(exitCode).toBe(0);
		},
		20000
	);
});
