import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../../runtime/index.ts';
import { installCustomPrograms } from '../programs/index.ts';

describe('binary stdio test', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		installCustomPrograms(kernel);
		kernel.mkdirSync('/tmp', { recursive: true });
		kernel.mkdirSync('/test', { recursive: true });
	});

	it.only('should relay binary data through nested subprocess stdout', async () => {
		console.error('[test] Creating binary relay test');

		// Inner script that writes binary data to stdout
		const innerScript = `
const binary = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
console.error('[inner] Writing binary data');
process.stdout.write(binary);
console.error('[inner] Done');
process.exit(0);
`;

		// Outer script that spawns inner and relays its binary stdout
		const outerScript = `
const child_process = require('child_process');
console.error('[outer] Starting');

const child = child_process.spawn('node', ['/test/inner.js'], {
	stdio: ['pipe', 'pipe', 'inherit']
});

child.stdout.on('data', (chunk) => {
	console.error('[outer] Got binary chunk, type:', chunk.constructor.name, 'length:', chunk.length || chunk.byteLength);
	// Write the binary data to our stdout
	process.stdout.write(chunk);
});

child.on('exit', (code) => {
	console.error('[outer] Child exited:', code);
	process.exit(0);
});
`;

		kernel.writeFileSync('/test/inner.js', innerScript, 'utf8');
		kernel.writeFileSync('/test/outer.js', outerScript, 'utf8');
		kernel.writeFileSync('/test/package.json', JSON.stringify({ type: 'commonjs' }), 'utf8');

		const subprocess = kernel.spawn({
			argv: ['node', '/test/outer.js'],
			env: { PATH: '/bin' },
			cwd: '/test',
			name: 'outer-process',
			stdio: {
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		if (typeof subprocess === 'number') {
			throw new Error('Failed to spawn subprocess');
		}

		const stdoutChunks: any[] = [];
		let allStderr = '';

		subprocess.stdout?.on('data', (chunk) => {
			console.log('[test] Got stdout chunk, type:', chunk.constructor.name);
			stdoutChunks.push(chunk);
		});

		subprocess.stderr?.on('data', (chunk) => {
			const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
			allStderr += text;
		});

		const exitCode = await new Promise<number>((resolve) => {
			subprocess.onExit((code) => resolve(code ?? 0));
		});

		console.log('[test] Exit code:', exitCode);
		console.log('[test] Stdout chunks:', stdoutChunks.length);
		console.log('[test] Stderr:', allStderr);

		expect(exitCode).toBe(0);
		expect(stdoutChunks.length).toBeGreaterThan(0);
		expect(allStderr).toContain('[outer] Got binary chunk');

		// Check that we received the binary data
		const firstChunk = stdoutChunks[0];
		expect(firstChunk).toBeInstanceOf(Uint8Array);
		const text = new TextDecoder().decode(firstChunk);
		expect(text).toBe('Hello');
	}, 15000);
});
