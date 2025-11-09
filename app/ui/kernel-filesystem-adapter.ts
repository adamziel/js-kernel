import type { AsyncWritableFilesystem } from './FilePickerTree/index';
import type { AsyncKernelProxy } from './kernel-proxy';

export function createKernelFilesystemAdapter(
	kernelProxy: AsyncKernelProxy
): AsyncWritableFilesystem {
	return {
		async isDir(path: string): Promise<boolean> {
			try {
				const stat = await kernelProxy.stat(path);
				return stat.isDirectory;
			} catch {
				return false;
			}
		},

		async fileExists(path: string): Promise<boolean> {
			return await kernelProxy.exists(path);
		},

		async readFileAsBuffer(path: string): Promise<Uint8Array> {
			const result = await kernelProxy.readFile(path, null);
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
			const result = await kernelProxy.readFile(path, 'utf8');
			if (typeof result === 'string') {
				return result;
			}
			if (result instanceof Uint8Array) {
				return new TextDecoder().decode(result);
			}
			throw new Error(`Unexpected readFileAsText result type for ${path}`);
		},

		async listFiles(path: string): Promise<string[]> {
			const entries = await kernelProxy.readdir(path);
			return entries.map((entry) => {
				if (typeof entry === 'string') {
					return entry;
				}
				return entry.name;
			});
		},

		async writeFile(path: string, data: Uint8Array | string): Promise<void> {
			await kernelProxy.writeFile(path, data);
		},

		async mkdir(path: string): Promise<void> {
			await kernelProxy.mkdir(path, { recursive: true });
		},

		async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
			await kernelProxy.rmdir(path, options);
		},

		async mv(source: string, destination: string): Promise<void> {
			await kernelProxy.rename(source, destination);
		},

		async unlink(path: string): Promise<void> {
			await kernelProxy.unlink(path);
		},
	};
}
