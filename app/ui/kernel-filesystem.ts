import type { Kernel } from '../../runtime/index.ts';
import type { AsyncKernelProxy } from './kernel-proxy.ts';

export interface KernelFilesystem {
	readFile(path: string): Promise<Uint8Array>;
	readFileAsText(path: string): Promise<string>;
	writeFile(path: string, content: string | Uint8Array): Promise<void>;
	listFiles(path: string): Promise<string[]>;
	isDir(path: string): Promise<boolean>;
	fileExists(path: string): Promise<boolean>;
	mkdir(path: string, recursive?: boolean): Promise<void>;
	unlink(path: string): Promise<void>;
	rmdir(path: string, recursive?: boolean): Promise<void>;
}

export function createKernelFilesystem(kernel: Kernel): KernelFilesystem {
	return {
		async readFile(path: string): Promise<Uint8Array> {
			const result = kernel.readFileSync(path, null);
			if (result instanceof Uint8Array) {
				return result;
			}
			if (result instanceof ArrayBuffer) {
				return new Uint8Array(result);
			}
			throw new Error(`Unexpected readFile result type for ${path}`);
		},

		async readFileAsText(path: string): Promise<string> {
			const result = kernel.readFileSync(path, 'utf8');
			if (typeof result === 'string') {
				return result;
			}
			if (result instanceof Uint8Array) {
				return new TextDecoder().decode(result);
			}
			throw new Error(`Unexpected readFileAsText result type for ${path}`);
		},

		async writeFile(path: string, content: string | Uint8Array): Promise<void> {
			kernel.writeFileSync(path, content);
		},

		async listFiles(path: string): Promise<string[]> {
			const entries = kernel.readdirSync(path);
			return entries.map((entry) => {
				if (typeof entry === 'string') {
					return entry;
				}
				return entry.name;
			});
		},

		async isDir(path: string): Promise<boolean> {
			try {
				const stat = kernel.statSync(path);
				return stat.isDirectory();
			} catch {
				return false;
			}
		},

		async fileExists(path: string): Promise<boolean> {
			return kernel.existsSync(path);
		},

		async mkdir(path: string, recursive = false): Promise<void> {
			kernel.mkdirSync(path, { recursive });
		},

		async unlink(path: string): Promise<void> {
			kernel.unlinkSync(path);
		},

		async rmdir(path: string, recursive = false): Promise<void> {
			kernel.rmdirSync(path, { recursive });
		},
	};
}

export function createKernelFilesystemFromProxy(proxy: AsyncKernelProxy): KernelFilesystem {
	return {
		async readFile(path: string): Promise<Uint8Array> {
			const result = await proxy.readFile(path, null);
			if (result instanceof Uint8Array) {
				return result;
			}
			if (result instanceof ArrayBuffer) {
				return new Uint8Array(result);
			}
			if (typeof result === 'string') {
				return new TextEncoder().encode(result);
			}
			throw new Error(`Unexpected readFile result type for ${path}`);
		},

		async readFileAsText(path: string): Promise<string> {
			const result = await proxy.readFile(path, 'utf8');
			if (typeof result === 'string') {
				return result;
			}
			if (result instanceof Uint8Array) {
				return new TextDecoder().decode(result);
			}
			throw new Error(`Unexpected readFileAsText result type for ${path}`);
		},

		async writeFile(path: string, content: string | Uint8Array): Promise<void> {
			await proxy.writeFile(path, content);
		},

		async listFiles(path: string): Promise<string[]> {
			const entries = await proxy.readdir(path);
			return entries.map((entry) => {
				if (typeof entry === 'string') {
					return entry;
				}
				return entry.name;
			});
		},

		async isDir(path: string): Promise<boolean> {
			try {
				const stat = await proxy.stat(path);
				return stat.isDirectory;
			} catch {
				return false;
			}
		},

		async fileExists(path: string): Promise<boolean> {
			return await proxy.exists(path);
		},

		async mkdir(path: string, recursive = false): Promise<void> {
			await proxy.mkdir(path, { recursive });
		},

		async unlink(path: string): Promise<void> {
			await proxy.unlink(path);
		},

		async rmdir(path: string, recursive = false): Promise<void> {
			await proxy.rmdir(path, { recursive });
		},
	};
}
