type KernelStdioChunk = string | Uint8Array;

export type NodeProcessExitInfo = {
	code: number;
	signal: string | null;
};

interface NodeRuntime {
	runMain(): unknown;
}

const clientBootUrl = new URL(
	'./node-loader/src/this-is-imported-directly/client-boot.js',
	import.meta.url
).href;

function createServiceWorkerImportUrl(sourceUrl: string): string | null {
	try {
		const target = new URL(sourceUrl, self.location.href);
		const origin =
			typeof self.location?.origin === 'string'
				? self.location.origin
				: `${target.protocol}//${target.host}`;
	const path = target.pathname || '/';
	return `${origin}${path}?import=${encodeURIComponent(path)}`;
	} catch {
		return null;
	}
}

async function importWithServiceWorker(url: string) {
	const swUrl = createServiceWorkerImportUrl(url);
	if (swUrl) {
		try {
			return await import(/* @vite-ignore */ swUrl);
		} catch (error) {
			console.warn(
				`Service worker import fallback failed for ${url}:`,
				error
			);
		}
	}
	return import(
		/* @vite-ignore */ url.slice(0, 4) + url.slice(4)
	);
}

let runtimePromise: Promise<NodeRuntime> | null = null;

export async function loadNode(): Promise<NodeRuntime> {
	if (!runtimePromise) {
		runtimePromise = bootstrapNodeRuntime();
	}
	return runtimePromise;
}

async function bootstrapNodeRuntime(): Promise<NodeRuntime> {
	let module;
	try {
		module = await importWithServiceWorker(clientBootUrl);
	} catch (error) {
		console.error(error);
		console.trace('Error loading client-boot.js:', error);
		throw error;
	}
	if (typeof module.runMain !== 'function') {
		throw new Error('client-boot.js did not export runMain');
	}

	return {
		runMain() {
			return Promise.resolve(module.runMain());
		},
	};
}
