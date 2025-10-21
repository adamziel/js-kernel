import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Kernel, ExitCode } from './kernel';
import { InMemoryFileSystem } from '../fs/in-memory/filesystem';
import type { SpawnOptions, KernelSubprocess } from './kernel';

describe('Kernel - Process Spawning and stdio Communication', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');
	});

	afterEach(() => {
		// Clean up any running processes (if killAll exists)
		if (typeof (kernel as any).killAll === 'function') {
			(kernel as any).killAll();
		}
	});

	describe('Basic Spawn Operations', () => {
		it('spawns a process with minimal options', () => {
			// Create a simple test program
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'test-process',
			});

			expect(result).not.toBe(ExitCode.NOT_FOUND);
			expect((result as KernelSubprocess).pid).toBeGreaterThan(0);
			expect(typeof (result as KernelSubprocess).kill).toBe('function');
		});

		it('returns NOT_FOUND for non-existent program', () => {
			const result = kernel.spawn({
				argv: ['nonexistent'],
				env: {},
				cwd: '/',
				name: 'missing',
			});

			expect(result).toBe(ExitCode.NOT_FOUND);
		});

		it('assigns unique PIDs to multiple processes', () => {
			const testProgram = `
				export default async function main() {
					// Keep process alive
					await new Promise(resolve => setTimeout(resolve, 1000));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const process1 = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'test1',
			}) as KernelSubprocess;

			const process2 = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'test2',
			}) as KernelSubprocess;

			expect(process1.pid).not.toBe(process2.pid);
			expect(process1.pid).toBeGreaterThan(0);
			expect(process2.pid).toBeGreaterThan(0);

			process1.kill();
			process2.kill();
		});

		it('spawns process with custom environment variables', () => {
			const testProgram = `
				export default async function main(processController) {
					const env = processController.getAllEnv();
					processController.stdout.write(JSON.stringify(env));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/env-test', testProgram);

			const result = kernel.spawn({
				argv: ['env-test'],
				env: { TEST_VAR: 'test-value', ANOTHER: 'value2' },
				cwd: '/',
				name: 'env-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			expect(result.stdout).toBeDefined();
		});

		it('spawns process with custom working directory', () => {
			kernel.mkdirSync('/test-dir', { recursive: true });
			const testProgram = `
				export default async function main(processController) {
					const cwd = processController.cwd();
					processController.stdout.write(cwd);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/cwd-test', testProgram);

			const result = kernel.spawn({
				argv: ['cwd-test'],
				env: {},
				cwd: '/test-dir',
				name: 'cwd-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			expect(result.pid).toBeGreaterThan(0);
		});
	});

	describe('stdio Communication - Pipe Mode', () => {
		it('provides stdin stream when stdio.stdin is "pipe"', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'stdin-test',
				stdio: { stdin: 'pipe' },
			}) as KernelSubprocess;

			expect(result.stdin).toBeDefined();
			expect(typeof result.stdin?.write).toBe('function');
		});

		it('provides stdout stream when stdio.stdout is "pipe"', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'stdout-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			expect(result.stdout).toBeDefined();
			expect(typeof result.stdout?.on).toBe('function');
		});

		it('provides stderr stream when stdio.stderr is "pipe"', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'stderr-test',
				stdio: { stderr: 'pipe' },
			}) as KernelSubprocess;

			expect(result.stderr).toBeDefined();
			expect(typeof result.stderr?.on).toBe('function');
		});

		it('allows writing to stdin and reading from stdout', async () => {
			const testProgram = `
				export default async function main(processController) {
					return new Promise((resolve) => {
						processController.stdin.on('data', (chunk) => {
							processController.stdout.write(chunk);
						});
						processController.stdin.on('end', () => {
							resolve(0);
						});
					});
				}
			`;
			kernel.writeFileSync('/bin/echo', testProgram);

			const result = kernel.spawn({
				argv: ['echo'],
				env: {},
				cwd: '/',
				name: 'echo-test',
				stdio: { stdin: 'pipe', stdout: 'pipe' },
			}) as KernelSubprocess;

			const outputChunks: string[] = [];
			result.stdout!.on('data', (chunk) => {
				outputChunks.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			// Write data to stdin
			result.stdin!.write('Hello, World!');
			result.stdin!.write('\n');
			result.stdin!.end();

			// Wait for process to complete
			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			const output = outputChunks.join('');
			expect(output).toContain('Hello, World!');
		});

		it('handles multiple writes to stdout', async () => {
			const testProgram = `
				export default async function main(processController) {
					for (let i = 0; i < 5; i++) {
						processController.stdout.write('Line ' + i + '\\n');
					}
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/multi-write', testProgram);

			const result = kernel.spawn({
				argv: ['multi-write'],
				env: {},
				cwd: '/',
				name: 'multi-write-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const outputChunks: string[] = [];
			result.stdout!.on('data', (chunk) => {
				outputChunks.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			const output = outputChunks.join('');
			expect(output).toContain('Line 0');
			expect(output).toContain('Line 4');
		});

		it('separates stdout and stderr streams', async () => {
			const testProgram = `
				export default async function main(processController) {
					processController.stdout.write('stdout message\\n');
					processController.stderr.write('stderr message\\n');
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/both-streams', testProgram);

			const result = kernel.spawn({
				argv: ['both-streams'],
				env: {},
				cwd: '/',
				name: 'both-streams-test',
				stdio: { stdout: 'pipe', stderr: 'pipe' },
			}) as KernelSubprocess;

			const stdoutChunks: string[] = [];
			const stderrChunks: string[] = [];

			result.stdout!.on('data', (chunk) => {
				stdoutChunks.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			result.stderr!.on('data', (chunk) => {
				stderrChunks.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			expect(stdoutChunks.join('')).toContain('stdout message');
			expect(stderrChunks.join('')).toContain('stderr message');
		});

		it('handles binary data through streams', async () => {
			const testProgram = `
				export default async function main(processController) {
					const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
					processController.stdout.write(binaryData);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/binary', testProgram);

			const result = kernel.spawn({
				argv: ['binary'],
				env: {},
				cwd: '/',
				name: 'binary-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const outputChunks: Uint8Array[] = [];
			result.stdout!.on('data', (chunk) => {
				if (chunk instanceof Uint8Array) {
					outputChunks.push(chunk);
				}
			});

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			expect(outputChunks.length).toBeGreaterThan(0);
			const decoded = new TextDecoder().decode(outputChunks[0]);
			expect(decoded).toBe('Hello');
		});
	});

	describe('stdio Communication - Ignore Mode', () => {
		it('does not provide stdin when stdio.stdin is "ignore"', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'stdin-ignore',
				stdio: { stdin: 'ignore' },
			}) as KernelSubprocess;

			expect(result.stdin).toBeUndefined();
		});

		it('does not provide stdout when stdio.stdout is "ignore"', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'stdout-ignore',
				stdio: { stdout: 'ignore' },
			}) as KernelSubprocess;

			expect(result.stdout).toBeUndefined();
		});

		it('does not provide stderr when stdio.stderr is "ignore"', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'stderr-ignore',
				stdio: { stderr: 'ignore' },
			}) as KernelSubprocess;

			expect(result.stderr).toBeUndefined();
		});
	});

	describe('stdio Communication - Inherit Mode', () => {
		it('does not provide stdout stream when stdio.stdout is "inherit"', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'stdout-inherit',
				stdio: { stdout: 'inherit' },
			}) as KernelSubprocess;

			// In inherit mode, parent doesn't get direct access to stream
			expect(result.stdout).toBeUndefined();
		});

		it('allows process to write to inherited console', async () => {
			const testProgram = `
				export default async function main(processController) {
					processController.stdout.write('Inherited output\\n');
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/inherit-test', testProgram);

			const consoleSpy = vi.spyOn(console, 'log');

			const result = kernel.spawn({
				argv: ['inherit-test'],
				env: {},
				cwd: '/',
				name: 'inherit-test',
				stdio: { stdout: 'inherit' },
			}) as KernelSubprocess;

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			// Note: This test verifies the process completes without errors
			// The actual console output is tested in the child controller
			expect(result.exitCode).toBe(0);

			consoleSpy.mockRestore();
		});
	});

	describe('stdio - Default Behavior', () => {
		it('uses default stdio when no stdio option provided', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'default-stdio',
			}) as KernelSubprocess;

			// Default behavior should be specified by implementation
			expect(result.pid).toBeGreaterThan(0);
		});
	});

	describe('Process Exit Handling', () => {
		it('captures exit code from successful process', async () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/success', testProgram);

			const result = kernel.spawn({
				argv: ['success'],
				env: {},
				cwd: '/',
				name: 'success-test',
			}) as KernelSubprocess;

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			expect(result.exitCode).toBe(0);
		});

		it('captures non-zero exit code from failed process', async () => {
			const testProgram = `
				export default async function main() {
					return 42;
				}
			`;
			kernel.writeFileSync('/bin/failure', testProgram);

			const result = kernel.spawn({
				argv: ['failure'],
				env: {},
				cwd: '/',
				name: 'failure-test',
			}) as KernelSubprocess;

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			expect(result.exitCode).toBe(42);
		});

		it('calls onExit listeners when process exits', async () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'exit-listener-test',
			}) as KernelSubprocess;

			const mockListener = vi.fn();
			result.onExit(mockListener);

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			expect(mockListener).toHaveBeenCalledTimes(1);
			expect(mockListener).toHaveBeenCalledWith(0);
		});

		it('calls multiple exit listeners', async () => {
			const testProgram = `
				export default async function main() {
					return 5;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'multi-listener-test',
			}) as KernelSubprocess;

			const listener1 = vi.fn();
			const listener2 = vi.fn();
			const listener3 = vi.fn();

			result.onExit(listener1);
			result.onExit(listener2);
			result.onExit(listener3);

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			expect(listener1).toHaveBeenCalledWith(5);
			expect(listener2).toHaveBeenCalledWith(5);
			expect(listener3).toHaveBeenCalledWith(5);
		});

		it('can remove exit listener with offExit', async () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'remove-listener-test',
			}) as KernelSubprocess;

			const listener = vi.fn();
			result.onExit(listener);
			result.offExit(listener);

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			expect(listener).not.toHaveBeenCalled();
		});

		it('returns null exitCode for running process', () => {
			const testProgram = `
				export default async function main() {
					await new Promise(resolve => setTimeout(resolve, 5000));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/long-running', testProgram);

			const result = kernel.spawn({
				argv: ['long-running'],
				env: {},
				cwd: '/',
				name: 'long-test',
			}) as KernelSubprocess;

			expect(result.exitCode).toBeNull();
			result.kill();
		});

		it('closes stdio streams when process exits', async () => {
			const testProgram = `
				export default async function main(processController) {
					processController.stdout.write('test');
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/stream-close', testProgram);

			const result = kernel.spawn({
				argv: ['stream-close'],
				env: {},
				cwd: '/',
				name: 'stream-close-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			let streamClosed = false;
			result.stdout!.on('close', () => {
				streamClosed = true;
			});

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			// Give streams time to close
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(streamClosed).toBe(true);
		});
	});

	describe('Process Kill Operations', () => {
		it('can kill a running process', async () => {
			const testProgram = `
				export default async function main() {
					await new Promise(resolve => setTimeout(resolve, 10000));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/long-running', testProgram);

			const result = kernel.spawn({
				argv: ['long-running'],
				env: {},
				cwd: '/',
				name: 'kill-test',
			}) as KernelSubprocess;

			expect(result.exitCode).toBeNull();

			result.kill();

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			// Process should have been killed
			expect(result.exitCode).not.toBeNull();
		});

		it('triggers exit listener when process is killed', async () => {
			const testProgram = `
				export default async function main() {
					await new Promise(resolve => setTimeout(resolve, 10000));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/long-running', testProgram);

			const result = kernel.spawn({
				argv: ['long-running'],
				env: {},
				cwd: '/',
				name: 'kill-listener-test',
			}) as KernelSubprocess;

			const exitListener = vi.fn();
			result.onExit(exitListener);

			result.kill();

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			expect(exitListener).toHaveBeenCalled();
		});

		it('killAll kills all running processes', async () => {
			const testProgram = `
				export default async function main() {
					await new Promise(resolve => setTimeout(resolve, 10000));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const proc1 = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'test1',
			}) as KernelSubprocess;

			const proc2 = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'test2',
			}) as KernelSubprocess;

			const proc3 = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'test3',
			}) as KernelSubprocess;

			kernel.killAll();

			await Promise.all([
				new Promise<void>((resolve) => proc1.onExit(() => resolve())),
				new Promise<void>((resolve) => proc2.onExit(() => resolve())),
				new Promise<void>((resolve) => proc3.onExit(() => resolve())),
			]);

			expect(proc1.exitCode).not.toBeNull();
			expect(proc2.exitCode).not.toBeNull();
			expect(proc3.exitCode).not.toBeNull();
		});
	});

	describe('Process Arguments and Context', () => {
		it('passes argv to process', async () => {
			const testProgram = `
				export default async function main(processController) {
					const argv = processController.argv();
					processController.stdout.write(JSON.stringify(argv));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/argv-test', testProgram);

			const result = kernel.spawn({
				argv: ['argv-test', '--flag', 'value', 'arg1'],
				env: {},
				cwd: '/',
				name: 'argv-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			result.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			const argv = JSON.parse(output.join(''));
			expect(argv).toContain('--flag');
			expect(argv).toContain('value');
			expect(argv).toContain('arg1');
		});

		it('provides process with correct PID', async () => {
			const testProgram = `
				export default async function main(processController) {
					const pid = processController.pid();
					processController.stdout.write(String(pid));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/pid-test', testProgram);

			const result = kernel.spawn({
				argv: ['pid-test'],
				env: {},
				cwd: '/',
				name: 'pid-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			result.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			const reportedPid = parseInt(output.join(''), 10);
			expect(reportedPid).toBe(result.pid);
		});
	});

	describe('Error Scenarios', () => {
		it('handles program that throws exception', async () => {
			const testProgram = `
				export default async function main() {
					throw new Error('Test error');
				}
			`;
			kernel.writeFileSync('/bin/error', testProgram);

			const result = kernel.spawn({
				argv: ['error'],
				env: {},
				cwd: '/',
				name: 'error-test',
			}) as KernelSubprocess;

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			// Process should exit with error code
			expect(result.exitCode).not.toBe(0);
		});

		it('handles invalid working directory gracefully', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			// Test that spawn handles non-existent cwd
			// Implementation may throw or return error
			const attempt = () =>
				kernel.spawn({
					argv: ['test'],
					env: {},
					cwd: '/nonexistent/path',
					name: 'bad-cwd',
				});

			// Either throws or returns error code
			try {
				const result = attempt();
				if (typeof result === 'number') {
					expect(result).not.toBe(0);
				}
			} catch (error) {
				expect(error).toBeDefined();
			}
		});

		it('handles process that exits via processController.exit()', async () => {
			const testProgram = `
				export default async function main(processController) {
					processController.exit(99);
				}
			`;
			kernel.writeFileSync('/bin/explicit-exit', testProgram);

			const result = kernel.spawn({
				argv: ['explicit-exit'],
				env: {},
				cwd: '/',
				name: 'explicit-exit-test',
			}) as KernelSubprocess;

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			expect(result.exitCode).toBe(99);
		});
	});

	describe('Stream Events', () => {
		it('emits "end" event when stdout is closed', async () => {
			const testProgram = `
				export default async function main(processController) {
					processController.stdout.write('data');
					processController.stdout.end();
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/end-test', testProgram);

			const result = kernel.spawn({
				argv: ['end-test'],
				env: {},
				cwd: '/',
				name: 'end-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const endCalled = vi.fn();
			result.stdout!.on('end', endCalled);

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			// Give events time to propagate
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(endCalled).toHaveBeenCalled();
		});

		it('emits "close" event on stdout when stream is closed', async () => {
			const testProgram = `
				export default async function main(processController) {
					processController.stdout.write('data');
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/close-test', testProgram);

			const result = kernel.spawn({
				argv: ['close-test'],
				env: {},
				cwd: '/',
				name: 'close-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const closeCalled = vi.fn();
			result.stdout!.on('close', closeCalled);

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			// Give events time to propagate
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(closeCalled).toHaveBeenCalled();
		});
	});

	describe('Message Port IPC', () => {
		it('provides messagePort when ipcPort is specified', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const channel = new MessageChannel();
			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'ipc-test',
				ipcPort: channel.port2,
			}) as KernelSubprocess;

			expect(result.messagePort).toBeDefined();
			channel.port1.close();
			channel.port2.close();
		});

		it('allows parent-child communication via messagePort', async () => {
			const testProgram = `
				export default async function main(processController) {
					return new Promise((resolve) => {
						processController.messagePort.onmessage = (event) => {
							processController.messagePort.postMessage({
								echo: event.data
							});
							resolve(0);
						};
					});
				}
			`;
			kernel.writeFileSync('/bin/ipc-echo', testProgram);

			const channel = new MessageChannel();
			const result = kernel.spawn({
				argv: ['ipc-echo'],
				env: {},
				cwd: '/',
				name: 'ipc-echo-test',
				ipcPort: channel.port2,
			}) as KernelSubprocess;

			const responsePromise = new Promise((resolve) => {
				channel.port1.onmessage = (event) => {
					resolve(event.data);
				};
			});

			channel.port1.postMessage({ test: 'hello' });

			const response = await responsePromise;
			expect(response).toEqual({ echo: { test: 'hello' } });

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			channel.port1.close();
		});
	});

	describe('Worker Thread Context', () => {
		it('provides threadId when workerThreadId is specified', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'thread-test',
				workerThreadId: 42,
			}) as KernelSubprocess;

			expect(result.threadId).toBe(42);
		});

		it('provides threadName when workerThreadName is specified', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'thread-test',
				workerThreadName: 'worker-1',
			}) as KernelSubprocess;

			expect(result.threadName).toBe('worker-1');
		});

		it('process can access its threadId internally', async () => {
			const testProgram = `
				export default async function main(processController) {
					const threadId = processController.threadId();
					processController.stdout.write(String(threadId));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/thread-id-test', testProgram);

			const result = kernel.spawn({
				argv: ['thread-id-test'],
				env: {},
				cwd: '/',
				name: 'thread-id-test',
				stdio: { stdout: 'pipe' },
				workerThreadId: 123,
			}) as KernelSubprocess;

			const output: string[] = [];
			result.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			const reportedThreadId = parseInt(output.join(''), 10);
			expect(reportedThreadId).toBe(123);
		});
	});

	describe('Large Data Transfers', () => {
		it('handles large stdout output', async () => {
			const testProgram = `
				export default async function main(processController) {
					// Write 1MB of data
					const chunk = 'x'.repeat(1024);
					for (let i = 0; i < 1024; i++) {
						processController.stdout.write(chunk);
					}
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/large-output', testProgram);

			const result = kernel.spawn({
				argv: ['large-output'],
				env: {},
				cwd: '/',
				name: 'large-output-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			let totalSize = 0;
			result.stdout!.on('data', (chunk) => {
				if (typeof chunk === 'string') {
					totalSize += chunk.length;
				} else {
					totalSize += chunk.length;
				}
			});

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			// Should have received ~1MB of data
			expect(totalSize).toBeGreaterThan(1024 * 1024 * 0.9); // Allow some margin
		});

		it('handles rapid writes without data loss', async () => {
			const testProgram = `
				export default async function main(processController) {
					for (let i = 0; i < 100; i++) {
						processController.stdout.write(i + '\\n');
					}
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/rapid-write', testProgram);

			const result = kernel.spawn({
				argv: ['rapid-write'],
				env: {},
				cwd: '/',
				name: 'rapid-write-test',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			result.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				result.onExit(() => resolve());
			});

			const fullOutput = output.join('');
			const lines = fullOutput.trim().split('\n');

			// Should have all 100 numbers
			expect(lines.length).toBe(100);
			expect(lines[0]).toBe('0');
			expect(lines[99]).toBe('99');
		});
	});

	describe('Process Name and Debug Options', () => {
		it('accepts debug flag in spawn options', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'debug-test',
				debug: true,
			}) as KernelSubprocess;

			expect(result.pid).toBeGreaterThan(0);
		});

		it('spawns process with custom name', () => {
			const testProgram = `
				export default async function main() {
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/test', testProgram);

			const result = kernel.spawn({
				argv: ['test'],
				env: {},
				cwd: '/',
				name: 'my-custom-process-name',
			}) as KernelSubprocess;

			expect(result.pid).toBeGreaterThan(0);
		});
	});
});
