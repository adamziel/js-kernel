import { describe, it, expect } from 'vitest';
import { Kernel } from './kernel';
import type { KernelSubprocess } from './kernel';

const decoder = new TextDecoder();

const extractJson = (text: string) => {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) {
		throw new Error(`Output did not contain JSON: ${text}`);
	}
	return JSON.parse(text.slice(start, end + 1));
};

describe('stdio integration', () => {
	it('echoes stdin using stream API', async () => {
		const kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');

		const program = `
			const decoder = new TextDecoder();
			export default async function main(processController) {
				const chunks = [];
				return new Promise((resolve) => {
					processController.stdin.on('data', (chunk) => {
						const value = typeof chunk === 'string' ? chunk : decoder.decode(chunk);
						chunks.push(value);
					});
					processController.stdin.on('end', () => {
						processController.stdout.write(JSON.stringify({ chunks }));
						resolve(0);
					});
				});
			}
		`;
		kernel.writeFileSync('/bin/echo', program);

		const proc = kernel.spawn({
			argv: ['echo'],
			env: {},
			cwd: '/',
			name: 'echo',
			stdio: { stdin: 'pipe', stdout: 'pipe' },
		}) as KernelSubprocess;

		let output = '';
		proc.stdout?.on('data', (chunk) => {
			output += typeof chunk === 'string' ? chunk : decoder.decode(chunk);
		});

		proc.stdin?.write('Hello!');
		proc.stdin?.end();

		await new Promise<void>((resolve) => proc.onExit(() => resolve()));

		const payload = extractJson(output);
		expect(payload.chunks).toEqual(['Hello!']);
	}, 10000);

	it('supports synchronous fsSync.readSync on stdin', async () => {
		const kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');

		const program = `
			const decoder = new TextDecoder();
			export default async function main(processController) {
				const first = processController.fsSync.readSync(0, 3, null);
				const second = processController.fsSync.readSync(0, 5, null);
				const toString = (chunk) =>
					typeof chunk === 'string' ? chunk : decoder.decode(chunk ?? new Uint8Array());
				processController.stdout.write(
					JSON.stringify({
						first: toString(first ?? new Uint8Array()),
						second: toString(second ?? new Uint8Array()),
					})
				);
				return 0;
			}
		`;
		kernel.writeFileSync('/bin/read-sync', program);

		const proc = kernel.spawn({
			argv: ['read-sync'],
			env: {},
			cwd: '/',
			name: 'read-sync',
			stdio: { stdin: 'pipe', stdout: 'pipe' },
		}) as KernelSubprocess;

		let output = '';
		proc.stdout?.on('data', (chunk) => {
			output += typeof chunk === 'string' ? chunk : decoder.decode(chunk);
		});

		proc.stdin?.write('abcdefgh');
		proc.stdin?.end();

		await new Promise<void>((resolve) => proc.onExit(() => resolve()));

	const payload = extractJson(output);
	expect(payload).toEqual({ first: 'abc', second: 'defgh' });
}, 10000);

	it('supports fs.readSync copying into provided buffer', async () => {
		const kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');

		const program = `
			const decoder = new TextDecoder();
			export default async function main(processController) {
				const buffer = new Uint8Array(16);
				const bytesRead = Number(processController.fsSync.readSync(0, buffer, 4, 5, null));
				const chunk = buffer.slice(4, 4 + bytesRead);
				processController.stdout.write(
					JSON.stringify({
						bytesRead,
						text: decoder.decode(chunk),
					})
				);
				return 0;
			}
		`;
		kernel.writeFileSync('/bin/fs-read-buffer', program);

		const proc = kernel.spawn({
			argv: ['fs-read-buffer'],
			env: {},
			cwd: '/',
			name: 'fs-read-buffer',
			stdio: { stdin: 'pipe', stdout: 'pipe' },
		}) as KernelSubprocess;

		let output = '';
		proc.stdout?.on('data', (chunk) => {
			output += typeof chunk === 'string' ? chunk : decoder.decode(chunk);
		});

		proc.stdin?.write('stdin-data');
		proc.stdin?.end();

		await new Promise<void>((resolve) => proc.onExit(() => resolve()));

		const payload = extractJson(output);
		expect(payload).toEqual({ bytesRead: 5, text: 'stdin' });
	}, 10000);
});
