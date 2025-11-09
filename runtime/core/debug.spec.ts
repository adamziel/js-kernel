import { describe, it, expect } from 'vitest';
import { Kernel, ExitCode } from './kernel';

describe('Debug - Minimal Spawn Test', () => {
	it('should find and load program', () => {
		const kernel = new Kernel();

		// Setup filesystem
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');

		// Write a program
		const program = `export default async function main() { return 0; }`;
		kernel.writeFileSync('/bin/test', program);

		// Verify file exists
		const exists = kernel.existsSync('/bin/test');
		console.log('File exists:', exists);
		expect(exists).toBe(true);

		// Read it back
		const content = kernel.readFileSync('/bin/test', 'utf8');
		console.log('File content:', content);
		expect(content).toBe(program);

		// Check PATH
		const path = kernel.getEnv('PATH');
		console.log('PATH:', path);
		expect(path).toBe('/bin');

		// Try to spawn
		console.log('Attempting spawn...');
		const result = kernel.spawn({
			argv: ['test'],
			env: {},
			cwd: '/',
			name: 'test',
		});

		console.log('Spawn result:', result);
		console.log('Result type:', typeof result);
		console.log('Is ExitCode.NOT_FOUND?', result === ExitCode.NOT_FOUND);
		console.log('ExitCode.NOT_FOUND value:', ExitCode.NOT_FOUND);

		if (typeof result === 'number') {
			throw new Error(`Spawn returned exit code ${result} instead of KernelSubprocess`);
		}

		expect(result).not.toBe(ExitCode.NOT_FOUND);
		expect(typeof result).toBe('object');
	});
});
