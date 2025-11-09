import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../runtime/index.ts';

describe('spawnSync stdin test', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');
	});

	it('should pass stdin data to spawnSync process', () => {
		// Create a simple echo program that reads from stdin and writes to stdout
		const echoProgram = `export default async function(processController) {
			// Read from stdin
			const stdin = processController.stdin;
			let data = '';

			while (true) {
				const chunk = stdin.read();
				if (chunk === null) break;
				data += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
			}

			// Write to stdout
			processController.stdout.write('RECEIVED: ' + data);
			processController.exit(0);
		}`;

		kernel.writeFileSync('/bin/echo', echoProgram, { mode: 0o755 });

		// Spawn the echo program with stdin input
		const result = kernel.spawnSync({
			argv: ['echo'],
			env: { PATH: '/bin' },
			cwd: '/',
			name: 'echo-test',
			input: 'Hello from stdin!',
			stdio: {
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		console.log('[test] spawnSync result:', {
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
			error: result.error,
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('RECEIVED: Hello from stdin!');
	});

	it('should handle binary stdin data in spawnSync', () => {
		// Create a program that reads binary data from stdin
		const binaryEchoProgram = `export default async function(processController) {
			const stdin = processController.stdin;
			const chunks = [];

			while (true) {
				const chunk = stdin.read();
				if (chunk === null) break;
				chunks.push(chunk);
			}

			// Calculate total length
			let totalLength = 0;
			for (const chunk of chunks) {
				totalLength += typeof chunk === 'string' ? chunk.length : chunk.byteLength;
			}

			processController.stdout.write('RECEIVED_BYTES: ' + totalLength);
			processController.exit(0);
		}`;

		kernel.writeFileSync('/bin/binary-echo', binaryEchoProgram, { mode: 0o755 });

		// Test with binary input
		const binaryInput = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

		const result = kernel.spawnSync({
			argv: ['binary-echo'],
			env: { PATH: '/bin' },
			cwd: '/',
			name: 'binary-echo-test',
			input: binaryInput,
			stdio: {
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		console.log('[test] binary spawnSync result:', {
			status: result.status,
			stdout: result.stdout,
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('RECEIVED_BYTES: 5');
	});

	it('should handle stdin in nested spawnSync (like esbuild)', () => {
		// This mimics esbuild's pattern: runner process spawns binary process

		// Binary program that reads from stdin and echoes back
		const binaryProgram = `export default async function(processController) {
			const stdin = processController.stdin;

			let data = '';
			while (true) {
				const chunk = stdin.read();
				if (chunk === null) break;
				data += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
			}

			processController.stdout.write('BINARY_GOT: ' + data);
			processController.exit(0);
		}`;

		// Runner program that spawns the binary with stdin
		const runnerProgram = `export default async function(processController) {
			// Spawn binary process with stdin data
			const result = processController.spawnSync({
				argv: ['binary'],
				env: { PATH: '/bin' },
				cwd: '/',
				name: 'nested-binary',
				input: 'ping',
				stdio: {
					stdin: 'pipe',
					stdout: 'pipe',
					stderr: 'pipe',
				},
			});

			processController.stdout.write('Runner received: ' + result.stdout);
			processController.exit(result.status || 0);
		}`;

		kernel.writeFileSync('/bin/binary', binaryProgram, { mode: 0o755 });
		kernel.writeFileSync('/bin/runner', runnerProgram, { mode: 0o755 });

		// Spawn runner which spawns binary
		const result = kernel.spawnSync({
			argv: ['runner'],
			env: { PATH: '/bin' },
			cwd: '/',
			name: 'runner-test',
			stdio: {
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			},
		});

		console.log('[test] nested spawnSync result:', {
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('BINARY_GOT: ping');
	});
});
