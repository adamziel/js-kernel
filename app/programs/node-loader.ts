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
	console.error('[node-loader] UNHANDLED REJECTION:', event.reason);
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
	console.log('[node-loader] loadNode called, runtimePromise exists:', !!runtimePromise);
	if (!runtimePromise) {
		console.log('[node-loader] Creating new runtimePromise');
		runtimePromise = bootstrapNodeRuntime().catch((error) => {
			console.error('[node-loader] FATAL ERROR in bootstrapNodeRuntime:', error);
			console.error('[node-loader] Error stack:', error?.stack);
			throw error;
		});
	}
	return runtimePromise;
}

async function bootstrapNodeRuntime(): Promise<NodeRuntime> {
	console.log('[node-loader] bootstrapNodeRuntime starting');
	let module;
	try {
		console.log('[node-loader] About to import client-boot from:', clientBootUrl);
		module = await importWithServiceWorker(clientBootUrl);
		console.log('[node-loader] Imported client-boot successfully');
	} catch (error) {
		console.error(error);
		console.trace('Error loading client-boot.js:', error);
		throw error;
	}
	if (typeof module.runMain !== 'function') {
		throw new Error('client-boot.js did not export runMain');
	}

	console.log('[node-loader] Returning runtime object');
	return {
		runMain() {
			console.log('[node-loader] runMain() called, calling module.runMain()...');
			const result = module.runMain();
			console.log('[node-loader] module.runMain() returned');
			return Promise.resolve(result);
		},
	};
}
