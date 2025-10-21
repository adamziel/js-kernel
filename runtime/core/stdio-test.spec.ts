import { describe, it, expect } from 'vitest';
import { Kernel } from './kernel';
import type { KernelSubprocess } from './kernel';

describe('stdio Echo Test', () => {
	it('echoes stdin to stdout', async () => {
		const kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');

		const program = `
			export default async function main(processController) {
				console.log('[echo] Program starting');
				return new Promise((resolve) => {
					processController.stdin.on('data', (chunk) => {
						console.log('[echo] Received on stdin:', chunk);
						processController.stdout.write(chunk);
						console.log('[echo] Wrote to stdout');
					});
					processController.stdin.on('end', () => {
						console.log('[echo] stdin ended, exiting');
						resolve(0);
					});
				});
			}
		`;
		kernel.writeFileSync('/bin/echo', program);

		const result = kernel.spawn({
			argv: ['echo'],
			env: {},
			cwd: '/',
			name: 'echo-test',
			stdio: { stdin: 'pipe', stdout: 'pipe' },
		}) as KernelSubprocess;

		const outputChunks: string[] = [];
		result.stdout!.on('data', (chunk) => {
			console.log('[test] Received on stdout:', chunk);
			outputChunks.push(
				typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
			);
		});

		console.log('[test] Writing to stdin');
		result.stdin!.write('Hello!');
		result.stdin!.end();

		await new Promise<void>((resolve) => {
			result.onExit(() => {
				console.log('[test] Process exited');
				resolve();
			});
		});

		console.log('[test] Output chunks:', outputChunks);
		expect(outputChunks.join('')).toContain('Hello!');
	}, 10000);
});
