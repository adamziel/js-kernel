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
		module = await import(
			/* @vite-ignore */ clientBootUrl.slice(0, 4) +
				clientBootUrl.slice(4)
		);
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
