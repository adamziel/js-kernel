import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../../runtime/index.ts';
import { installCustomPrograms } from '../programs/index.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('subprocess bidirectional stdio', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		installCustomPrograms(kernel); // This installs the real node program
		kernel.mkdirSync('/tmp', { recursive: true });
	});

	it.only('should emit stdout data events that can be read synchronously', async () => {
		// Create a script that writes multiple chunks to stdout
		const script = `
console.error('[script] Starting script');
const messages = ['chunk1\\n', 'chunk2\\n', 'chunk3\\n'];
console.error('[script] About to write', messages.length, 'messages');
for (const msg of messages) {
	console.error('[script] Writing:', msg.trim());
	process.stdout.write(msg);
}
console.error('[script] Done writing, calling exit');
process.exit(0);
`;

		kernel.mkdirSync('/test', { recursive: true});
		kernel.writeFileSync('/test/writer.js', script, 'utf8');
		kernel.writeFileSync(
			'/test/package.json',
			JSON.stringify({ type: 'commonjs' }),
			'utf8'
		);

		const subprocess = kernel.spawn({
			argv: ['node', '/test/writer.js'],
			env: { PATH: '/bin' },
			cwd: '/test',
			name: 'stdout-test',
			stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
		});

		if (typeof subprocess === 'number') {
			throw new Error('Failed to spawn subprocess');
		}

		const chunks: string[] = [];
		const stderrChunks: string[] = [];

		subprocess.stdout?.on('data', (chunk) => {
			const text =
				typeof chunk === 'string'
					? chunk
					: decoder.decode(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
			console.log('[test] Got stdout chunk:', text);
			chunks.push(text);
		});

		subprocess.stderr?.on('data', (chunk) => {
			const text =
				typeof chunk === 'string'
					? chunk
					: decoder.decode(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
			console.log('[test] Got stderr chunk:', text);
			stderrChunks.push(text);
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		console.log('[test] Exit code:', exitCode);
		console.log('[test] Stdout chunks received:', chunks);
		console.log('[test] Stderr chunks received:', stderrChunks);

		const allStderr = stderrChunks.join('');
		console.log('[test] Full stderr:', allStderr);

		expect(exitCode).toBe(0);
		expect(chunks.length).toBeGreaterThan(0);
		const allText = chunks.join('');
		expect(allText).toContain('chunk1');
		expect(allText).toContain('chunk2');
		expect(allText).toContain('chunk3');
	}, 10000);

	it('should support bidirectional communication (write to stdin, read from stdout)', async () => {
		// Create an echo script
		const script = `
process.stdin.on('data', (chunk) => {
	process.stdout.write('ECHO: ' + chunk);
});
process.stdin.on('end', () => {
	process.exit(0);
});
`;

		kernel.mkdirSync('/test', { recursive: true });
		kernel.writeFileSync('/test/echo.js', script, 'utf8');
		kernel.writeFileSync(
			'/test/package.json',
			JSON.stringify({ type: 'commonjs' }),
			'utf8'
		);

		const subprocess = kernel.spawn({
			argv: ['node', '/test/echo.js'],
			env: { PATH: '/bin' },
			cwd: '/test',
			name: 'echo-test',
			stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
		});

		if (typeof subprocess === 'number') {
			throw new Error('Failed to spawn subprocess');
		}

		const chunks: string[] = [];

		subprocess.stdout?.on('data', (chunk) => {
			const text =
				typeof chunk === 'string'
					? chunk
					: decoder.decode(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
			console.log('[test] Got echo response:', text);
			chunks.push(text);
		});

		// Write to stdin
		subprocess.stdin?.write('Hello\n');
		subprocess.stdin?.write('World\n');
		subprocess.stdin?.end();

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		console.log('[test] Exit code:', exitCode);
		console.log('[test] Echo responses:', chunks);

		expect(exitCode).toBe(0);
		const allText = chunks.join('');
		expect(allText).toContain('ECHO: Hello');
		expect(allText).toContain('ECHO: World');
	}, 10000);
});
