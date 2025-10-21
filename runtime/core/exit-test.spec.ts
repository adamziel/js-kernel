import { describe, it, expect } from 'vitest';
import { Kernel } from './kernel';
import type { KernelSubprocess } from './kernel';

describe('Exit Code Test', () => {
	it('captures exit code', async () => {
		const kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');

		const program = `
			export default async function main() {
				console.log('Program running...');
				return 42;
			}
		`;
		kernel.writeFileSync('/bin/test', program);

		const result = kernel.spawn({
			argv: ['test'],
			env: {},
			cwd: '/',
			name: 'test',
		}) as KernelSubprocess;

		console.log('Initial exitCode:', result.exitCode);

		await new Promise<void>((resolve) => {
			result.onExit((code) => {
				console.log('onExit called with code:', code);
				const ec = result.exitCode;
				console.log('result.exitCode (via const):', ec);
				console.log('typeof result.exitCode:', typeof result.exitCode);
				console.log('result has exitCode prop:', 'exitCode' in result);
				const descriptor = Object.getOwnPropertyDescriptor(result, 'exitCode');
				console.log('Property descriptor:', descriptor);
				resolve();
			});
		});

		console.log('Final exitCode:', result.exitCode);
		expect(result.exitCode).toBe(42);
	});
});
