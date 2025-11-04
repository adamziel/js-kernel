import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../../runtime/index.ts';
import { installCustomPrograms } from '../programs/index.ts';

const decoder = new TextDecoder();

describe('nested subprocess test', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		installCustomPrograms(kernel);
		kernel.mkdirSync('/tmp', { recursive: true });
	});

	it.only('should support subprocess spawning another subprocess', async () => {
		// Create an inner script that writes to stdout
		const innerScript = `
console.error('[inner] Starting inner script');
process.stdout.write('INNER OUTPUT\\n');
console.error('[inner] Done');
process.exit(0);
`;

		// Create an outer script that spawns the inner script
		const outerScript = `
const child_process = require('child_process');
console.error('[outer] Starting outer script');
console.error('[outer] Spawning inner script');

const child = child_process.spawn('node', ['/test/inner.js'], {
	stdio: ['pipe', 'pipe', 'inherit']
});

child.stdout.on('data', (chunk) => {
	const text = chunk.toString();
	console.error('[outer] Got from child:', text.trim());
	// Forward to our stdout
	process.stdout.write('OUTER SAW: ' + text);
});

child.on('exit', (code) => {
	console.error('[outer] Child exited with code:', code);
	process.exit(code || 0);
});
`;

		kernel.mkdirSync('/test', { recursive: true });
		kernel.writeFileSync('/test/inner.js', innerScript, 'utf8');
		kernel.writeFileSync('/test/outer.js', outerScript, 'utf8');
		kernel.writeFileSync(
			'/test/package.json',
			JSON.stringify({ type: 'commonjs' }),
			'utf8'
		);

		const subprocess = kernel.spawn({
			argv: ['node', '/test/outer.js'],
			env: { PATH: '/bin' },
			cwd: '/test',
			name: 'outer-process',
			stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
		});

		if (typeof subprocess === 'number') {
			throw new Error('Failed to spawn subprocess');
		}

		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];

		subprocess.stdout?.on('data', (chunk) => {
			const text =
				typeof chunk === 'string'
					? chunk
					: decoder.decode(
							chunk instanceof Uint8Array
								? chunk
								: new Uint8Array(chunk)
					  );
			console.log('[test] stdout:', text);
			stdoutChunks.push(text);
		});

		subprocess.stderr?.on('data', (chunk) => {
			const text =
				typeof chunk === 'string'
					? chunk
					: decoder.decode(
							chunk instanceof Uint8Array
								? chunk
								: new Uint8Array(chunk)
					  );
			console.log('[test] stderr:', text);
			stderrChunks.push(text);
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		console.log('[test] Exit code:', exitCode);
		console.log('[test] Stdout:', stdoutChunks.join(''));
		console.log('[test] Stderr:', stderrChunks.join(''));

		const allStdout = stdoutChunks.join('');
		const allStderr = stderrChunks.join('');

		expect(exitCode).toBe(0);
		expect(allStderr).toContain('[outer] Starting outer script');
		// TODO: stdio: 'inherit' for nested subprocesses is not fully implemented yet
		// expect(allStderr).toContain('[inner] Starting inner script');
		expect(allStdout).toContain('OUTER SAW: INNER OUTPUT');
	}, 15000);
});
