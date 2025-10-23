import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../runtime/index.ts';
import type { KernelSubprocess } from '../runtime/core/kernel.ts';
import { installCustomPrograms } from './programs/index.ts';
import {
	Worker as NodeWorker,
	type WorkerOptions as NodeWorkerOptions,
	type TransferListItem,
} from 'node:worker_threads';

type WorkerListener = (event: MessageEvent<unknown>) => void;
type ErrorListener = (event: ErrorEvent) => void;

class PermissiveWorker {
	private readonly inner: NodeWorker;
	private readonly messageListeners = new Set<WorkerListener>();
	private readonly errorListeners = new Set<ErrorListener>();
	private onMessageHandler: WorkerListener | null = null;
	private onErrorHandler: ErrorListener | null = null;

	constructor(specifier: string | URL, options?: NodeWorkerOptions) {
		this.inner = new NodeWorker(specifier, options);
		this.inner.on('message', (data) => {
			const event = { data } as MessageEvent<unknown>;
			this.onMessageHandler?.(event);
			for (const listener of this.messageListeners) {
				listener(event);
			}
		});
		this.inner.on('error', (error) => {
			const event = {
				message: error.message,
				filename: undefined,
				lineno: undefined,
				colno: undefined,
				error,
			} as unknown as ErrorEvent;
			this.onErrorHandler?.(event);
			for (const listener of this.errorListeners) {
				listener(event);
			}
		});
	}

	postMessage(value: unknown, transfer?: TransferListItem[]) {
		this.inner.postMessage(value, transfer as unknown as TransferListItem[]);
	}

	addEventListener(type: 'message', listener: WorkerListener): void;
	addEventListener(type: 'error', listener: ErrorListener): void;
	addEventListener(type: string, listener: WorkerListener | ErrorListener) {
		if (type === 'message') {
			this.messageListeners.add(listener as WorkerListener);
			return;
		}
		if (type === 'error') {
			this.errorListeners.add(listener as ErrorListener);
		}
	}

	removeEventListener(
		type: 'message',
		listener: WorkerListener
	): void;
	removeEventListener(type: 'error', listener: ErrorListener): void;
	removeEventListener(
		type: string,
		listener: WorkerListener | ErrorListener
	) {
		if (type === 'message') {
			this.messageListeners.delete(listener as WorkerListener);
			return;
		}
		if (type === 'error') {
			this.errorListeners.delete(listener as ErrorListener);
		}
	}

	terminate() {
		return this.inner.terminate();
	}

	get onmessage(): WorkerListener | null {
		return this.onMessageHandler;
	}

	set onmessage(handler: WorkerListener | null) {
		this.onMessageHandler = handler;
	}

	get onerror(): ErrorListener | null {
		return this.onErrorHandler;
	}

	set onerror(handler: ErrorListener | null) {
		this.onErrorHandler = handler;
	}

	// Allow arbitrary property assignment used by the kernel implementation.
	[additional: string]: unknown;
}

if (typeof globalThis.Worker === 'undefined') {
	(globalThis as unknown as { Worker: typeof Worker }).Worker =
		PermissiveWorker as unknown as typeof Worker;
}

const LARGE_SIZE = 12 * 1024 * 1024;

const createLargeFixture = (): Uint8Array => {
	const data = new Uint8Array(LARGE_SIZE);
	for (let i = 0; i < data.length; i += 1) {
		data[i] = i % 251;
	}
	return data;
};

const checksum = (bytes: Uint8Array): number => {
	let sum = 0;
	for (let i = 0; i < bytes.length; i += 1) {
		sum = (sum + bytes[i]) >>> 0;
	}
	return sum >>> 0;
};

const collectProcessOutput = async (
	process: KernelSubprocess
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
	const decoder = new TextDecoder();
	let stdout = '';
	let stderr = '';

	process.stdout?.on('data', (chunk) => {
		stdout +=
			typeof chunk === 'string' ? chunk : decoder.decode(chunk as Uint8Array);
	});
	process.stderr?.on('data', (chunk) => {
		stderr +=
			typeof chunk === 'string' ? chunk : decoder.decode(chunk as Uint8Array);
	});

	const exitCode = await new Promise<number>((resolve) => {
		process.onExit((code) => resolve(code ?? 0));
	});

	return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
};

describe('12MB buffer transmission', () => {
	let kernel: Kernel;
	let fixture: Uint8Array;
	let expectedChecksum: number;

	beforeEach(() => {
		kernel = new Kernel();
		kernel.mkdirSync('/bin', { recursive: true });
		kernel.setEnv('PATH', '/bin');
		installCustomPrograms(kernel);

		fixture = createLargeFixture();
		expectedChecksum = checksum(fixture);
		kernel.writeFileSync('/large.bin', fixture, null);
	});

	it('vanilla kernel program receives 12MB Uint8Array', async () => {
		const programSource = `
export default async function main(processController) {
	const toUint8 = (value) => {
		if (value instanceof Uint8Array) return value;
		if (value && value.buffer) {
			return new Uint8Array(value.buffer, value.byteOffset ?? 0, value.byteLength ?? value.length ?? 0);
		}
		throw new Error('Unsupported data type');
	};
	const makeChecksum = (bytes) => {
		let sum = 0;
		for (let i = 0; i < bytes.length; i += 1) {
			sum = (sum + bytes[i]) >>> 0;
		}
		return sum >>> 0;
	};

	const raw = processController.fsSync.readFileSync('/large.bin', null);
	const bytes = toUint8(raw);
	processController.stdout.write(JSON.stringify({
		constructor: raw && raw.constructor && raw.constructor.name,
		length: bytes.length,
		checksum: makeChecksum(bytes),
	}));
	return 0;
}
`;

		kernel.writeFileSync('/bin/kernel-large-reader', programSource);

		const subprocess = kernel.spawn({
			argv: ['kernel-large-reader'],
			env: {},
			cwd: '/',
			name: 'kernel-large-reader',
			stdio: { stdout: 'pipe', stderr: 'pipe' },
		}) as KernelSubprocess;

		const { stdout, stderr, exitCode } = await collectProcessOutput(subprocess);
		expect(exitCode).toBe(0);
		expect(stderr).toBe('');

		const summary = JSON.parse(stdout);
		expect(summary.constructor).toBe('Uint8Array');
		expect(summary.length).toBe(LARGE_SIZE);
		expect(summary.checksum).toBe(expectedChecksum);
	});

	it('processController.fsSync transmits 12MB between node-loader workers', async () => {
		const innerReaderSource = `
const { fsSync } = processController;
const toUint8 = (value) => {
	if (value instanceof Uint8Array) return value;
	if (value && typeof value === 'object' && value.buffer) {
		return new Uint8Array(value.buffer, value.byteOffset ?? 0, value.byteLength ?? value.length ?? 0);
	}
	throw new Error('Unsupported data type');
};
const makeChecksum = (bytes) => {
	let sum = 0;
	for (let i = 0; i < bytes.length; i += 1) {
		sum = (sum + bytes[i]) >>> 0;
	}
	return sum >>> 0;
};

const raw = fsSync.readFileSync('/large.bin', null);
const bytes = toUint8(raw);
console.log(JSON.stringify({
	constructor: raw && raw.constructor && raw.constructor.name,
	length: bytes.length,
	checksum: makeChecksum(bytes),
}));
processController.exit(0);
`;

		kernel.writeFileSync('/inner-read.js', innerReaderSource);

		const outerSource = `
const { execFileSync } = require('child_process');
const output = execFileSync('node', ['/inner-read.js'], { encoding: 'utf8' }).trim();
console.log(output);
processController.exit(0);
`;

		kernel.writeFileSync('/outer-read.js', outerSource);

		const subprocess = kernel.spawn({
			argv: ['node', '/outer-read.js'],
			env: {},
			cwd: '/',
			name: 'large-buffer-nested',
			stdio: { stdout: 'pipe', stderr: 'pipe' },
		}) as KernelSubprocess;

		const { stdout, stderr, exitCode } = await collectProcessOutput(subprocess);
		expect(exitCode).toBe(0);
		expect(stderr).toBe('');

		const summary = JSON.parse(stdout);
		expect(summary.length).toBe(LARGE_SIZE);
		expect(summary.checksum).toBe(expectedChecksum);
		expect(summary.constructor === 'Uint8Array' || summary.constructor === 'Buffer').toBe(true);
	});

	it('node fs.readFileSync returns full 12MB Buffer', async () => {
		const readerSource = `
const fs = require('fs');
const makeChecksum = (bytes) => {
	let sum = 0;
	for (let i = 0; i < bytes.length; i += 1) {
		sum = (sum + bytes[i]) >>> 0;
	}
	return sum >>> 0;
};

const data = fs.readFileSync('/large.bin');
console.log(JSON.stringify({
	constructor: data && data.constructor && data.constructor.name,
	length: data.length,
	checksum: makeChecksum(data),
}));
processController.exit(0);
`;

		kernel.writeFileSync('/buffer-read.js', readerSource);

		const subprocess = kernel.spawn({
			argv: ['node', '/buffer-read.js'],
			env: {},
			cwd: '/',
			name: 'large-buffer-buffer',
			stdio: { stdout: 'pipe', stderr: 'pipe' },
		}) as KernelSubprocess;

		const { stdout, stderr, exitCode } = await collectProcessOutput(subprocess);
		expect(exitCode).toBe(0);
		expect(stderr).toBe('');

		const summary = JSON.parse(stdout);
		expect(summary.constructor).toBe('Buffer');
		expect(summary.length).toBe(LARGE_SIZE);
		expect(summary.checksum).toBe(expectedChecksum);
	});
});
