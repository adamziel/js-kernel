/**
 * Helper to read OPFS logs from the browser console
 * Run in browser dev tools console:
 *
 * (async () => {
 *   const root = await navigator.storage.getDirectory();
 *   const fileHandle = await root.getFileHandle('message-port-debug.log');
 *   const file = await fileHandle.getFile();
 *   const text = await file.text();
 *   console.log(text);
 * })();
 */

export async function readOPFSLog(logName: string): Promise<string> {
	try {
		const root = await navigator.storage.getDirectory();
		const fileHandle = await root.getFileHandle(`${logName}.log`);
		const file = await fileHandle.getFile();
		return await file.text();
	} catch (err) {
		return `Failed to read log: ${err}`;
	}
}

export async function clearOPFSLogs(): Promise<void> {
	try {
		const root = await navigator.storage.getDirectory();
		// @ts-ignore
		for await (const entry of root.values()) {
			if (entry.name.endsWith('.log')) {
				await root.removeEntry(entry.name);
			}
		}
		console.log('[OPFS] All logs cleared');
	} catch (err) {
		console.error('[OPFS] Clear failed:', err);
	}
}

// Auto-expose to window for easy console access
if (typeof window !== 'undefined') {
	(window as any).readOPFSLog = readOPFSLog;
	(window as any).clearOPFSLogs = clearOPFSLogs;
}
