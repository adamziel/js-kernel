type KernelStdioChunk = string | Uint8Array;

export type NodeProcessExitInfo = {
	code: number;
	signal: string | null;
};

interface NodeRuntime {
	runMain(): unknown;
}

// Add global error handlers
self.addEventListener('error', (event) => {
	console.error('[node-loader] UNCAUGHT ERROR:', event.error);
	console.error('[node-loader] Error message:', event.message);
	console.error('[node-loader] Error filename:', event.filename);
	console.error('[node-loader] Error line:', event.lineno);
});

self.addEventListener('unhandledrejection', (event) => {
	const reason = event.reason;
	const formatted =
		reason && typeof reason === 'object' && 'stack' in reason
			? (reason as { stack?: string }).stack || String(reason)
			: String(reason);
	console.error('[node-loader] UNHANDLED REJECTION:', formatted);
	console.error('[node-loader] Promise:', event.promise);
});

const clientBootUrl = new URL(
	'./node-loader/src/this-is-imported-directly/client-boot.js',
	import.meta.url
).href;

function createServiceWorkerImportUrl(sourceUrl: string): string | null {
	console.log('[createServiceWorkerImportUrl] START');
	try {
		console.log('[createServiceWorkerImportUrl] Creating URL object...');
		const target = new URL(sourceUrl, self.location.href);
		console.log('[createServiceWorkerImportUrl] URL created, getting origin...');
		const origin =
			typeof self.location?.origin === 'string'
				? self.location.origin
				: `${target.protocol}//${target.host}`;
		console.log('[createServiceWorkerImportUrl] Origin:', origin);
	const path = target.pathname || '/';
	console.log('[createServiceWorkerImportUrl] Path:', path);
	const result = `${origin}${path}?import=${encodeURIComponent(path)}`;
	console.log('[createServiceWorkerImportUrl] Result created, returning');
	return result;
	} catch (e) {
		console.error('[createServiceWorkerImportUrl] ERROR:', e);
		return null;
	}
}

async function importWithServiceWorker(url: string) {
	const result = await import(/* @vite-ignore */ url);
	return result;
}

let runtimePromise: Promise<NodeRuntime> | null = null;

export async function loadNode(): Promise<NodeRuntime> {
	if (!runtimePromise) {
		runtimePromise = bootstrapNodeRuntime().catch((error) => {
			console.error('[node-loader] FATAL ERROR in bootstrapNodeRuntime:', error);
			console.error('[node-loader] Error stack:', error?.stack);
			throw error;
		});
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
			const result = module.runMain();
			return Promise.resolve(result);
		},
	};
}
