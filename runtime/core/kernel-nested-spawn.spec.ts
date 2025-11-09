import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kernel } from './kernel';
import { InMemoryFileSystem } from '../fs/in-memory/filesystem';
import type { KernelSubprocess } from './kernel';

describe('Kernel - Nested Process Spawning', () => {
	let kernel: Kernel;

	beforeEach(() => {
		kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');
	});

	afterEach(() => {
		if (typeof (kernel as any).killAll === 'function') {
			(kernel as any).killAll();
		}
	});

	describe('Child Process Spawning', () => {
		it('allows child process to spawn another process', async () => {
			// Create grandchild program
			const grandchildProgram = `
				export default async function main(processController) {
					processController.stdout.write('grandchild');
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/grandchild', grandchildProgram);

			// Create child program that spawns grandchild
			const childProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['grandchild'],
						env: {},
						cwd: '/',
						name: 'grandchild-process',
						stdio: { stdout: 'pipe' }
					});

					let output = '';
					child.stdout.on('data', (chunk) => {
						output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					processController.stdout.write('child-' + output);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/child', childProgram);

			const parent = kernel.spawn({
				argv: ['child'],
				env: {},
				cwd: '/',
				name: 'parent-process',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('child-grandchild');
		});

		it('allows multiple levels of nesting', async () => {
			// Level 3 program
			const level3Program = `
				export default async function main(processController) {
					processController.stdout.write('L3');
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/level3', level3Program);

			// Level 2 program
			const level2Program = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['level3'],
						env: {},
						cwd: '/',
						name: 'level3',
						stdio: { stdout: 'pipe' }
					});

					let output = '';
					child.stdout.on('data', (chunk) => {
						output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					processController.stdout.write('L2-' + output);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/level2', level2Program);

			// Level 1 program
			const level1Program = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['level2'],
						env: {},
						cwd: '/',
						name: 'level2',
						stdio: { stdout: 'pipe' }
					});

					let output = '';
					child.stdout.on('data', (chunk) => {
						output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					processController.stdout.write('L1-' + output);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/level1', level1Program);

			const parent = kernel.spawn({
				argv: ['level1'],
				env: {},
				cwd: '/',
				name: 'parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('L1-L2-L3');
		});

		it('child process inherits environment variables', async () => {
			const childProgram = `
				export default async function main(processController) {
					const value = processController.getEnv('TEST_VAR');
					processController.stdout.write(value);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/env-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['env-child'],
						env: processController.getAllEnv(),
						cwd: '/',
						name: 'env-child',
						stdio: { stdout: 'pipe' }
					});

					let output = '';
					child.stdout.on('data', (chunk) => {
						output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					processController.stdout.write(output);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/env-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['env-parent'],
				env: { TEST_VAR: 'inherited-value' },
				cwd: '/',
				name: 'env-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('inherited-value');
		});

		it('child process can override environment variables', async () => {
			const childProgram = `
				export default async function main(processController) {
					const value = processController.getEnv('TEST_VAR');
					processController.stdout.write(value);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/env-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['env-child'],
						env: { TEST_VAR: 'overridden' },
						cwd: '/',
						name: 'env-child',
						stdio: { stdout: 'pipe' }
					});

					let output = '';
					child.stdout.on('data', (chunk) => {
						output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					processController.stdout.write(output);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/env-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['env-parent'],
				env: { TEST_VAR: 'original' },
				cwd: '/',
				name: 'env-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('overridden');
		});

		it('parent can spawn multiple children simultaneously', async () => {
			const childProgram = `
				export default async function main(processController) {
					const id = processController.argv()[1];
					await new Promise(resolve => setTimeout(resolve, 100));
					processController.stdout.write('child-' + id);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/multi-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const children = [];

					for (let i = 0; i < 5; i++) {
						const child = await processController.spawn({
							argv: ['multi-child', String(i)],
							env: {},
							cwd: '/',
							name: 'child-' + i,
							stdio: { stdout: 'pipe' }
						});
						children.push(child);
					}

					const results = await Promise.all(children.map(child => {
						return new Promise((resolve) => {
							let output = '';
							child.stdout.on('data', (chunk) => {
								output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
							});
							child.onExit(() => resolve(output));
						});
					}));

					processController.stdout.write(results.sort().join(','));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/multi-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['multi-parent'],
				env: {},
				cwd: '/',
				name: 'multi-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			const result = output.join('');
			expect(result).toContain('child-0');
			expect(result).toContain('child-1');
			expect(result).toContain('child-2');
			expect(result).toContain('child-3');
			expect(result).toContain('child-4');
		});

		it('propagates exit codes from child to parent', async () => {
			const childProgram = `
				export default async function main() {
					return 42;
				}
			`;
			kernel.writeFileSync('/bin/exit-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['exit-child'],
						env: {},
						cwd: '/',
						name: 'exit-child',
						stdio: {}
					});

					const exitCode = await new Promise((resolve) => {
						child.onExit((code) => resolve(code));
					});

					processController.stdout.write(String(exitCode));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/exit-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['exit-parent'],
				env: {},
				cwd: '/',
				name: 'exit-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('42');
		});

		it('child process can kill its own children', async () => {
			const grandchildProgram = `
				export default async function main() {
					await new Promise(resolve => setTimeout(resolve, 10000));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/long-grandchild', grandchildProgram);

			const childProgram = `
				export default async function main(processController) {
					const grandchild = await processController.spawn({
						argv: ['long-grandchild'],
						env: {},
						cwd: '/',
						name: 'grandchild',
						stdio: {}
					});

					// Immediately kill the grandchild
					grandchild.kill();

					await new Promise((resolve) => {
						grandchild.onExit(() => resolve());
					});

					processController.stdout.write('killed');
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/killer-child', childProgram);

			const parent = kernel.spawn({
				argv: ['killer-child'],
				env: {},
				cwd: '/',
				name: 'killer-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('killed');
		});

		it('killing parent kills all children (cascade)', async () => {
			const grandchildProgram = `
				export default async function main() {
					await new Promise(resolve => setTimeout(resolve, 10000));
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/long-grandchild', grandchildProgram);

			const childProgram = `
				export default async function main(processController) {
					const grandchild = await processController.spawn({
						argv: ['long-grandchild'],
						env: {},
						cwd: '/',
						name: 'grandchild',
						stdio: {}
					});

					// Wait for grandchild (but parent will be killed)
					await new Promise((resolve) => {
						grandchild.onExit(() => resolve());
					});

					return 0;
				}
			`;
			kernel.writeFileSync('/bin/waiting-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['waiting-child'],
						env: {},
						cwd: '/',
						name: 'waiting-child',
						stdio: {}
					});

					// Wait forever (parent will be killed from outside)
					await new Promise(() => {});
				}
			`;
			kernel.writeFileSync('/bin/cascade-parent', childProgram);

			const parent = kernel.spawn({
				argv: ['cascade-parent'],
				env: {},
				cwd: '/',
				name: 'cascade-parent',
			}) as KernelSubprocess;

			// Give time for children to spawn
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Kill the parent
			parent.kill();

			// Wait for parent to exit
			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			// Parent should have been killed
			expect(parent.exitCode).not.toBeNull();
		});
	});

	describe('Child Process stdio Piping', () => {
		it('parent can read from child stdout', async () => {
			const childProgram = `
				export default async function main(processController) {
					processController.stdout.write('hello from child');
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['child'],
						env: {},
						cwd: '/',
						name: 'child',
						stdio: { stdout: 'pipe' }
					});

					let output = '';
					child.stdout.on('data', (chunk) => {
						output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					processController.stdout.write(output);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['parent'],
				env: {},
				cwd: '/',
				name: 'parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('hello from child');
		});

		it('parent can write to child stdin', async () => {
			const childProgram = `
				export default async function main(processController) {
					return new Promise((resolve) => {
						processController.stdin.on('data', (chunk) => {
							const data = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
							processController.stdout.write('received: ' + data);
						});
						processController.stdin.on('end', () => {
							resolve(0);
						});
					});
				}
			`;
			kernel.writeFileSync('/bin/stdin-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['stdin-child'],
						env: {},
						cwd: '/',
						name: 'stdin-child',
						stdio: { stdin: 'pipe', stdout: 'pipe' }
					});

					let output = '';
					child.stdout.on('data', (chunk) => {
						output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					child.stdin.write('test input');
					child.stdin.end();

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					processController.stdout.write(output);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/stdin-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['stdin-parent'],
				env: {},
				cwd: '/',
				name: 'stdin-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('received: test input');
		});

		it('parent can read from child stderr separately', async () => {
			const childProgram = `
				export default async function main(processController) {
					processController.stdout.write('to stdout');
					processController.stderr.write('to stderr');
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/both-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['both-child'],
						env: {},
						cwd: '/',
						name: 'both-child',
						stdio: { stdout: 'pipe', stderr: 'pipe' }
					});

					let stdout = '';
					let stderr = '';

					child.stdout.on('data', (chunk) => {
						stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					child.stderr.on('data', (chunk) => {
						stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					processController.stdout.write('stdout:' + stdout + '|stderr:' + stderr);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/both-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['both-parent'],
				env: {},
				cwd: '/',
				name: 'both-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('stdout:to stdout|stderr:to stderr');
		});

		it('child can use ignore mode for stdio', async () => {
			const childProgram = `
				export default async function main(processController) {
					// Try to write, but it's ignored
					processController.stdout.write('ignored');
					return 7;
				}
			`;
			kernel.writeFileSync('/bin/ignore-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['ignore-child'],
						env: {},
						cwd: '/',
						name: 'ignore-child',
						stdio: { stdout: 'ignore' }
					});

					const exitCode = await new Promise((resolve) => {
						child.onExit((code) => resolve(code));
					});

					processController.stdout.write('exit:' + exitCode);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/ignore-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['ignore-parent'],
				env: {},
				cwd: '/',
				name: 'ignore-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('exit:7');
		});
	});

	describe('Process Error Propagation', () => {
		it('parent handles child spawn failure', async () => {
			const parentProgram = `
				export default async function main(processController) {
					try {
						const child = await processController.spawn({
							argv: ['nonexistent'],
							env: {},
							cwd: '/',
							name: 'nonexistent',
							stdio: {}
						});
						processController.stdout.write('unexpected success');
					} catch (error) {
						processController.stdout.write('spawn failed');
					}
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/error-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['error-parent'],
				env: {},
				cwd: '/',
				name: 'error-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('spawn failed');
		});

		it('parent handles child that throws exception', async () => {
			const childProgram = `
				export default async function main() {
					throw new Error('child error');
				}
			`;
			kernel.writeFileSync('/bin/error-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['error-child'],
						env: {},
						cwd: '/',
						name: 'error-child',
						stdio: {}
					});

					const exitCode = await new Promise((resolve) => {
						child.onExit((code) => resolve(code));
					});

					processController.stdout.write('child-exit:' + exitCode);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/error-handler', parentProgram);

			const parent = kernel.spawn({
				argv: ['error-handler'],
				env: {},
				cwd: '/',
				name: 'error-handler',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			const result = output.join('');
			expect(result).toContain('child-exit:');
			// Exit code should be non-zero for error
			expect(result).not.toContain('child-exit:0');
		});
	});

	describe('Filesystem Access in Child Processes', () => {
		it('child process can access filesystem', async () => {
			kernel.writeFileSync('/test.txt', 'file content');

			const childProgram = `
				export default async function main(processController) {
					const content = await processController.fs.async.readFile('/test.txt', 'utf8');
					processController.stdout.write(content);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/fs-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['fs-child'],
						env: {},
						cwd: '/',
						name: 'fs-child',
						stdio: { stdout: 'pipe' }
					});

					let output = '';
					child.stdout.on('data', (chunk) => {
						output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					processController.stdout.write(output);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/fs-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['fs-parent'],
				env: {},
				cwd: '/',
				name: 'fs-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('file content');
		});

		it('child process can write to filesystem', async () => {
			const childProgram = `
				export default async function main(processController) {
					await processController.fs.async.writeFile('/child-file.txt', 'written by child');
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/write-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['write-child'],
						env: {},
						cwd: '/',
						name: 'write-child',
						stdio: {}
					});

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					const content = await processController.fs.async.readFile('/child-file.txt', 'utf8');
					processController.stdout.write(content);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/write-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['write-parent'],
				env: {},
				cwd: '/',
				name: 'write-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('written by child');
		});

		it('child process respects cwd for relative paths', async () => {
			kernel.mkdirSync('/subdir', { recursive: true });
			kernel.writeFileSync('/subdir/file.txt', 'in subdir');

			const childProgram = `
				export default async function main(processController) {
					const cwd = processController.cwd();
					const content = await processController.fs.async.readFile('file.txt', 'utf8');
					processController.stdout.write(cwd + ':' + content);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/cwd-fs-child', childProgram);

			const parentProgram = `
				export default async function main(processController) {
					const child = await processController.spawn({
						argv: ['cwd-fs-child'],
						env: {},
						cwd: '/subdir',
						name: 'cwd-fs-child',
						stdio: { stdout: 'pipe' }
					});

					let output = '';
					child.stdout.on('data', (chunk) => {
						output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
					});

					await new Promise((resolve) => {
						child.onExit(() => resolve());
					});

					processController.stdout.write(output);
					return 0;
				}
			`;
			kernel.writeFileSync('/bin/cwd-fs-parent', parentProgram);

			const parent = kernel.spawn({
				argv: ['cwd-fs-parent'],
				env: {},
				cwd: '/',
				name: 'cwd-fs-parent',
				stdio: { stdout: 'pipe' },
			}) as KernelSubprocess;

			const output: string[] = [];
			parent.stdout!.on('data', (chunk) => {
				output.push(
					typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
				);
			});

			await new Promise<void>((resolve) => {
				parent.onExit(() => resolve());
			});

			expect(output.join('')).toBe('/subdir:in subdir');
		});
	});
});
