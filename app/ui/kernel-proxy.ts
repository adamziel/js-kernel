/**
 * Proxy to communicate with the kernel running in a worker
 */
export interface KernelProxy {
	readFileSync(path: string, encoding: 'utf8' | null): string | Uint8Array;
	writeFileSync(path: string, content: string | Uint8Array): void;
	readdirSync(path: string): Array<string | { name: string }>;
	statSync(path: string): { isDirectory(): boolean };
	existsSync(path: string): boolean;
	mkdirSync(path: string, options?: { recursive?: boolean }): void;
	unlinkSync(path: string): void;
	rmdirSync(path: string, options?: { recursive?: boolean }): void;
}

let requestId = 0;
const pendingRequests = new Map<
	number,
	{ resolve: (value: any) => void; reject: (error: any) => void }
>();

export function createKernelProxy(worker: Worker): KernelProxy {
	// Listen for responses from the worker
	worker.addEventListener('message', (event) => {
		if (event.data.type === 'kernel-response') {
			const { id, result, error } = event.data;
			const pending = pendingRequests.get(id);
			if (pending) {
				pendingRequests.delete(id);
				if (error) {
					pending.reject(new Error(error));
				} else {
					pending.resolve(result);
				}
			}
		}
	});

	function callKernel(method: string, args: any[]): any {
		const id = requestId++;
		return new Promise((resolve, reject) => {
			pendingRequests.set(id, { resolve, reject });
			worker.postMessage({
				type: 'kernel-request',
				id,
				method,
				args,
			});
		});
	}

	return {
		readFileSync(path: string, encoding: 'utf8' | null) {
			// For sync operations, we'll need to use a different approach
			// Since we can't do actual sync in workers, we'll throw for now
			throw new Error('Synchronous operations not supported in kernel proxy. Use async methods instead.');
		},
		writeFileSync(path: string, content: string | Uint8Array) {
			throw new Error('Synchronous operations not supported in kernel proxy. Use async methods instead.');
		},
		readdirSync(path: string) {
			throw new Error('Synchronous operations not supported in kernel proxy. Use async methods instead.');
		},
		statSync(path: string) {
			throw new Error('Synchronous operations not supported in kernel proxy. Use async methods instead.');
		},
		existsSync(path: string) {
			throw new Error('Synchronous operations not supported in kernel proxy. Use async methods instead.');
		},
		mkdirSync(path: string, options?: { recursive?: boolean }) {
			throw new Error('Synchronous operations not supported in kernel proxy. Use async methods instead.');
		},
		unlinkSync(path: string) {
			throw new Error('Synchronous operations not supported in kernel proxy. Use async methods instead.');
		},
		rmdirSync(path: string, options?: { recursive?: boolean }) {
			throw new Error('Synchronous operations not supported in kernel proxy. Use async methods instead.');
		},
	};
}

// Async version that actually works with workers
export interface AsyncKernelProxy {
	readFile(path: string, encoding?: 'utf8' | null): Promise<string | Uint8Array>;
	writeFile(path: string, content: string | Uint8Array): Promise<void>;
	readdir(path: string): Promise<Array<string | { name: string }>>;
	stat(path: string): Promise<{ isDirectory: boolean }>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	unlink(path: string): Promise<void>;
	rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
}

export function createAsyncKernelProxy(worker: Worker): AsyncKernelProxy {
	// Listen for responses from the worker
	worker.addEventListener('message', (event) => {
		if (event.data.type === 'kernel-response') {
			const { id, result, error } = event.data;
			const pending = pendingRequests.get(id);
			if (pending) {
				pendingRequests.delete(id);
				if (error) {
					pending.reject(new Error(error));
				} else {
					pending.resolve(result);
				}
			}
		}
	});

	function callKernel(method: string, args: any[]): Promise<any> {
		const id = requestId++;
		return new Promise((resolve, reject) => {
			pendingRequests.set(id, { resolve, reject });
			worker.postMessage({
				type: 'kernel-request',
				id,
				method,
				args,
			});

			// Add timeout to detect stuck requests
			setTimeout(() => {
				if (pendingRequests.has(id)) {
					console.error('[KernelProxy] Request timeout:', { id, method, args });
					pendingRequests.delete(id);
					reject(new Error(`Kernel request timeout: ${method}`));
				}
			}, 5000);
		});
	}

	return {
		async readFile(path: string, encoding: 'utf8' | null = null) {
			return callKernel('readFileSync', [path, encoding]);
		},
		async writeFile(path: string, content: string | Uint8Array) {
			return callKernel('writeFileSync', [path, content]);
		},
		async readdir(path: string) {
			return callKernel('readdirSync', [path, undefined]);
		},
		async stat(path: string) {
			const result = await callKernel('statSync', [path]);
			return { isDirectory: result.isDirectory };
		},
		async exists(path: string) {
			return callKernel('existsSync', [path]);
		},
		async mkdir(path: string, options?: { recursive?: boolean }) {
			return callKernel('mkdirSync', [path, options]);
		},
		async unlink(path: string) {
			return callKernel('unlinkSync', [path]);
		},
		async rmdir(path: string, options?: { recursive?: boolean }) {
			return callKernel('rmdirSync', [path, options]);
		},
		async rename(oldPath: string, newPath: string) {
			return callKernel('renameSync', [oldPath, newPath]);
		},
	};
}
