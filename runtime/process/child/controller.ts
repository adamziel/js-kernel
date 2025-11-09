import {
	BasicEventEmitter,
	KernelStdioChunk,
	MessagePortReadableStream,
	MessagePortWritableStream,
} from '../../ipc/message-port.ts';
import {
	CONTROL_MESSAGE_CHILD_EXIT,
	CONTROL_MESSAGE_HOST_KILL_CHILD,
	CONTROL_MESSAGE_KILL_REQUEST,
	CONTROL_MESSAGE_KILL_RESULT,
	CONTROL_MESSAGE_PROCESS_EXIT,
	CONTROL_MESSAGE_REPORT_CHILD_EXIT,
	CONTROL_MESSAGE_SPAWN_REQUEST,
	CONTROL_MESSAGE_SPAWN_RESULT,
	CONTROL_MESSAGE_STDIN_DATA,
} from '../constants.ts';
import { createProcessWorker } from '../worker-factory.ts';
import {
	normalizeSpawnOptions,
	type NormalizedSpawnOptions,
	type StdioMode,
} from '../spawn-options.ts';
import { joinPaths, normalizePath } from '../../util/paths.ts';
import type { KernelFsClient } from './fs-client.ts';
import { createWasmFsKernelConnector } from './wasmfs-connector.ts';
import { createKernelFsClient } from './fs-client.ts';
import {
	createSpawnSyncClient,
	type SpawnSyncClient,
} from '../spawn-sync/client.ts';

type FsConnectorType = 'shared' | 'wasmfs';

const createFsClient = async (
	options: ChildProcessInitOptions,
	stdio?: ChildStdioStreams
): Promise<KernelFsClient> => {
	const requested: FsConnectorType =
		options.fsType === 'shared' || options.fsType === 'wasmfs'
			? options.fsType
			: 'shared';

	if (requested === 'shared') {
		if (typeof SharedArrayBuffer === 'undefined') {
			throw new Error(
				'Shared filesystem connector requested, but SharedArrayBuffer is unavailable'
			);
		} else if (options.fsPort) {
			try {
				return createKernelFsClient(options.fsPort, stdio);
			} catch (error) {
				throw new Error(
					`Failed to initialize shared-buffer filesystem connector: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
		} else {
			throw new Error(
				'Shared filesystem connector requested, but no fsPort was provided'
			);
		}
	}

	return createWasmFsKernelConnector(stdio);
};

// Error handling
// Preserve the original console for easier debugging and error logging.
// @TODO: How to balance having stderr with direct console access?
globalThis.originalConsole = globalThis.console;
// Handle uncaught exceptions
globalThis.addEventListener('error', (errorEvent) => {
	globalThis.originalConsole.error('uncaughtException', errorEvent);
});

// Handle unhandled promise rejections
globalThis.addEventListener('unhandledrejection', (rejectionEvent) => {
	globalThis.originalConsole.error(rejectionEvent);
});

export type { StdioMode } from '../spawn-options.ts';

// Request kernel message ports from parent
export const requestKernelPorts = (): Promise<[MessagePort, MessagePort]> => {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(
				new Error(
					'Failed to receive kernel message ports within 1 second'
				)
			);
		}, 1000);

		const handleMessage = (event: MessageEvent) => {
			if (
				event.data?.type === 'kernelMessagePorts' &&
				Array.isArray(event.data.ports) &&
				event.data.ports.length === 2
			) {
				clearTimeout(timeout);
				self.removeEventListener('message', handleMessage);
				resolve([event.data.ports[0], event.data.ports[1]]);
			}
		};

		self.addEventListener('message', handleMessage);

		// Request the ports from parent
		self.postMessage({ type: 'requestKernelMessagePorts' });
	});
};

interface ChildStdioDescriptor {
	fd: 0 | 1 | 2;
	mode: StdioMode;
	port?: MessagePort;
}

interface ChildProcessInitOptions {
	pid: number;
	argv: string[];
	env: Record<string, string>;
	cwd: string;
	debug: boolean;
	stdio: ChildStdioDescriptor[];
	programPath: string;
	programSource: string;
	controlPort: MessagePort;
	fsPort: MessagePort;
	spawnSyncPort: MessagePort;
	messagePort: MessagePort | null;
	threadId?: number;
	threadName?: string;
	fsType?: FsConnectorType;
}

interface ProcessControllerSpawnOptions {
	argv: string[];
	env?: Record<string, string>;
	cwd?: string;
	name?: string;
	debug?: boolean;
	stdio?: {
		stdin?: StdioMode;
		stdout?: StdioMode;
		stderr?: StdioMode;
	};
	timeout?: number;
	ipcPort?: MessagePort;
	workerThreadId?: number;
	workerThreadName?: string;
	fsConnector?: 'auto' | 'shared' | 'wasmfs';
}

interface SpawnPlanMessage {
	pid: number;
	programPath: string;
	programSource: string;
	stdio: Array<{
		fd: 0 | 1 | 2;
		mode: StdioMode;
		workerPort: MessagePort | null;
		parentPort: MessagePort | null;
	}>;
	controlPort: MessagePort;
	fsPort: MessagePort;
	spawnSyncPort: MessagePort;
	messagePort?: {
		workerPort: MessagePort | null;
		parentPort: MessagePort | null;
	};
	threadId?: number;
	threadName?: string;
	fsType: FsConnectorType;
}

type ExitListener = (code: number) => void;

interface ChildProcessHandle {
	pid: number;
	stdin?: MessagePortWritableStream;
	stdout?: MessagePortReadableStream;
	stderr?: MessagePortReadableStream;
	messagePort?: MessagePort | null;
	threadId?: number;
	threadName?: string;
	onExit(listener: ExitListener): void;
	offExit(listener: ExitListener): void;
	kill(): void;
	readonly exitCode: number | null;
}

interface PendingSpawnRequest {
	options: NormalizedSpawnOptions;
	resolve: (handle: ChildProcessHandle) => void;
	reject: (error: Error) => void;
}

interface LocalChildProcessRecord {
	handle: ChildProcessHandle;
	worker: Worker;
	exitListeners: Set<ExitListener>;
	setExitCode: (code: number) => void;
}

type ProcessControllerFs = KernelFsClient['async'] & {
	async: KernelFsClient['async'];
	sync: KernelFsClient['sync'];
};

const createProcessControllerFs = (
	client: KernelFsClient,
	getCwd: () => string
): ProcessControllerFs => {
	const asyncApi = client.async as KernelFsClient['async'];
	const syncApi = client.sync as KernelFsClient['sync'];

	const isAbsolutePath = (path: string) =>
		path.startsWith('/') || /^[a-zA-Z]+:/.test(path);

	const resolvePathArgument = (value: unknown): unknown => {
		if (typeof value !== 'string' || value.length === 0) {
			return value;
		}
		const cwd = (() => {
			const current = getCwd();
			return current && current.length > 0 ? current : '/';
		})();
		return isAbsolutePath(value)
			? normalizePath(value)
			: normalizePath(joinPaths(cwd, value));
	};

	const normalizeSymlinkArguments = (
		target: unknown,
		linkPath: unknown
	): [unknown, unknown] => {
		return [resolvePathArgument(target), resolvePathArgument(linkPath)];
	};

	const asyncFs = Object.create(asyncApi) as KernelFsClient['async'];

	asyncFs.access = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.access;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.access is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.appendFile = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.appendFile;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.appendFile is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.chmod = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.chmod;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.chmod is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.chown = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.chown;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.chown is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.copyFile = (
		source: unknown,
		destination: unknown,
		...rest: unknown[]
	) => {
		const fn = asyncApi.copyFile;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.copyFile is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [
			resolvePathArgument(source),
			resolvePathArgument(destination),
			...rest,
		]);
	};

	asyncFs.exists = (path: unknown, ...rest: unknown[]) => {
		const fn = (asyncApi as Record<string, unknown>).exists;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.exists is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.link = (
		existingPath: unknown,
		newPath: unknown,
		...rest: unknown[]
	) => {
		const fn = asyncApi.link;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.link is not supported by this connector');
		}
		return fn.apply(asyncApi, [
			normalizePath(existingPath as string),
			normalizePath(newPath as string),
			...rest,
		]);
	};

	asyncFs.lstat = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.lstat;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.lstat is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.mkdir = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.mkdir;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.mkdir is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.mkdtemp = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.mkdtemp;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.mkdtemp is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.open = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.open;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.open is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.opendir = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.opendir;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.opendir is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.readFile = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.readFile;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.readFile is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.readdir = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.readdir;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.readdir is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.readlink = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.readlink;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.readlink is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.realpath = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.realpath;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.realpath is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.rename = (
		oldPath: unknown,
		newPath: unknown,
		...rest: unknown[]
	) => {
		const fn = asyncApi.rename;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.rename is not supported by this connector');
		}
		return fn.apply(asyncApi, [
			normalizePath(oldPath as string),
			normalizePath(newPath as string),
			...rest,
		]);
	};

	asyncFs.rm = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.rm;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.rm is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.rmdir = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.rmdir;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.rmdir is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.stat = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.stat;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.stat is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.symlink = (
		target: unknown,
		linkPath: unknown,
		...rest: unknown[]
	) => {
		const fn = asyncApi.symlink;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.symlink is not supported by this connector'
			);
		}
		const [normalizedTarget, normalizedLinkPath] =
			normalizeSymlinkArguments(target, linkPath);
		return fn.apply(asyncApi, [
			normalizedTarget,
			normalizedLinkPath,
			...rest,
		]);
	};

	asyncFs.truncate = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.truncate;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.truncate is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.unlink = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.unlink;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.unlink is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.utimes = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.utimes;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.utimes is not supported by this connector');
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.watch = (pathOrOptions: unknown, ...rest: unknown[]) => {
		const fn = (asyncApi as Record<string, unknown>).watch;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.watch is not supported by this connector');
		}
		if (typeof pathOrOptions === 'string') {
			const normalizedPath = resolvePathArgument(pathOrOptions);
			return fn.apply(asyncApi, [normalizedPath, ...rest]);
		}
		return fn.apply(asyncApi, [pathOrOptions, ...rest]);
	};

	asyncFs.watchFile = (path: unknown, ...rest: unknown[]) => {
		const fn = (asyncApi as Record<string, unknown>).watchFile;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.watchFile is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.unwatchFile = (path: unknown, ...rest: unknown[]) => {
		const fn = (asyncApi as Record<string, unknown>).unwatchFile;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.unwatchFile is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	asyncFs.writeFile = (path: unknown, ...rest: unknown[]) => {
		const fn = asyncApi.writeFile;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.writeFile is not supported by this connector'
			);
		}
		return fn.apply(asyncApi, [resolvePathArgument(path), ...rest]);
	};

	const syncFs = Object.create(syncApi) as KernelFsClient['sync'];

	syncFs.accessSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.accessSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.accessSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.appendFileSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.appendFileSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.appendFileSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.chmodSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.chmodSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.chmodSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.chownSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.chownSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.chownSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.copyFileSync = (
		source: unknown,
		destination: unknown,
		...rest: unknown[]
	) => {
		const fn = syncApi.copyFileSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.copyFileSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [
			normalizePath(source as string),
			normalizePath(destination as string),
			...rest,
		]);
	};

	syncFs.existsSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.existsSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.existsSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.linkSync = (
		existingPath: unknown,
		newPath: unknown,
		...rest: unknown[]
	) => {
		const fn = syncApi.linkSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.linkSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [
			normalizePath(existingPath as string),
			normalizePath(newPath as string),
			...rest,
		]);
	};

	syncFs.lstatSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.lstatSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.lstatSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.mkdirSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.mkdirSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.mkdirSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.mkdtempSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.mkdtempSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.mkdtempSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.openSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.openSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.openSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.opendirSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.opendirSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.opendirSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.readFileSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.readFileSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.readFileSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.readdirSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.readdirSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.readdirSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.readlinkSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.readlinkSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.readlinkSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.realpathSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.realpathSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.realpathSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.renameSync = (
		oldPath: unknown,
		newPath: unknown,
		...rest: unknown[]
	) => {
		const fn = syncApi.renameSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.renameSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [
			normalizePath(oldPath as string),
			normalizePath(newPath as string),
			...rest,
		]);
	};

	syncFs.rmSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.rmSync;
		if (typeof fn !== 'function') {
			throw new TypeError('fs.rmSync is not supported by this connector');
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.rmdirSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.rmdirSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.rmdirSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.statSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.statSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.statSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.symlinkSync = (
		target: unknown,
		linkPath: unknown,
		...rest: unknown[]
	) => {
		const fn = syncApi.symlinkSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.symlinkSync is not supported by this connector'
			);
		}
		const [normalizedTarget, normalizedLinkPath] =
			normalizeSymlinkArguments(target, linkPath);
		return fn.apply(syncApi, [
			normalizedTarget,
			normalizedLinkPath,
			...rest,
		]);
	};

	syncFs.truncateSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.truncateSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.truncateSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.unlinkSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.unlinkSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.unlinkSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.utimesSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.utimesSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.utimesSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	syncFs.writeFileSync = (path: unknown, ...rest: unknown[]) => {
		const fn = syncApi.writeFileSync;
		if (typeof fn !== 'function') {
			throw new TypeError(
				'fs.writeFileSync is not supported by this connector'
			);
		}
		return fn.apply(syncApi, [resolvePathArgument(path), ...rest]);
	};

	const processFs = asyncFs as ProcessControllerFs;
	(processFs as Record<string, unknown>).async = asyncFs;
	(processFs as Record<string, unknown>).promises = asyncFs;
	(processFs as Record<string, unknown>).sync = syncFs;

	return processFs;
};

interface ChildReadableEvents extends Record<string, unknown> {
	data: KernelStdioChunk;
	end: void;
	close: void;
}

class NullReadableStream extends BasicEventEmitter<ChildReadableEvents> {
	read() {
		return null;
	}

	isClosed() {
		return true;
	}

	isEnded() {
		return true;
	}

	close() {
		this.clearAll();
	}

	destroy() {
		this.clearAll();
	}
}

interface ChildWritableEvents extends Record<string, unknown> {
	close: void;
}

class NullWritableStream extends BasicEventEmitter<ChildWritableEvents> {
	write(_chunk: KernelStdioChunk) {
		return false;
	}

	end(_chunk?: KernelStdioChunk) {
		this.destroy();
		return false;
	}

	close() {
		this.destroy();
		return false;
	}

	destroy() {
		this.clearAll();
	}
}

type ChildReadableStream = MessagePortReadableStream | NullReadableStream;
type ChildWritableStream = MessagePortWritableStream | NullWritableStream;

interface ChildStdioStreams {
	stdin: ChildReadableStream;
	stdout: ChildWritableStream;
	stderr: ChildWritableStream;
}

const createChildStdio = (
	descriptors: ChildStdioDescriptor[]
): ChildStdioStreams => {
	const descriptorFor = (fd: 0 | 1 | 2): ChildStdioDescriptor =>
		descriptors.find((descriptor) => descriptor.fd === fd) ?? {
			fd,
			// Default stdin to 'pipe' for IPC communication, others to 'ignore'
			mode: (fd === 0 ? 'pipe' : 'ignore') as StdioMode,
			port: undefined,
		};

	const stdinDescriptor = descriptorFor(0);
	const stdoutDescriptor = descriptorFor(1);
	const stderrDescriptor = descriptorFor(2);

	return {
		stdin: createReadableStream(stdinDescriptor),
		stdout: createWritableStream(stdoutDescriptor),
		stderr: createWritableStream(stderrDescriptor),
	};
};

const createReadableStream = (
	descriptor: ChildStdioDescriptor
): ChildReadableStream => {
	if (descriptor.mode === 'ignore' || !descriptor.port) {
		return new NullReadableStream();
	}
	const label =
		descriptor.fd === 0
			? 'binary:stdin'
			: descriptor.fd === 1
			? 'binary:stdout'
			: 'binary:stderr';
	return new MessagePortReadableStream(descriptor.port, {
		debugLabel: label,
	});
};

const createWritableStream = (
	descriptor: ChildStdioDescriptor
): ChildWritableStream => {
	if (descriptor.mode === 'ignore' || !descriptor.port) {
		return new NullWritableStream();
	}
	const label =
		descriptor.fd === 0
			? 'binary:stdin'
			: descriptor.fd === 1
			? 'binary:stdout'
			: 'binary:stderr';
	return new MessagePortWritableStream(descriptor.port, {
		debugLabel: label,
	});
};

const toKernelChunk = (value: unknown): KernelStdioChunk => {
	if (typeof value === 'string') {
		return value;
	}
	if (value instanceof Uint8Array) {
		return value;
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		return new Uint8Array(
			view.buffer,
			view.byteOffset,
			view.byteLength
		).slice();
	}
	if (value === null || typeof value === 'undefined') {
		return String(value);
	}
	try {
		if (typeof value === 'object') {
			const json = JSON.stringify(value);
			return typeof json === 'string' ? json : String(value);
		}
		return String(value);
	} catch {
		return String(value);
	}
};

const appendTrailingNewlineIfText = (
	chunk: KernelStdioChunk
): KernelStdioChunk => {
	if (typeof chunk === 'string') {
		return chunk.endsWith('\n') ? chunk : `${chunk}\n`;
	}
	return chunk;
};

let childProcessState: ChildProcessInitOptions | null = null;
let stdioStreams: ChildStdioStreams | null = null;
let controlPort: MessagePort | null = null;
let fsClient: KernelFsClient | null = null;
let spawnSyncClient: SpawnSyncClient | null = null;
let bootstrapComplete = false;
let programStarted = false;
let nextSpawnRequestId = 1;
const pendingSpawnRequests = new Map<number, PendingSpawnRequest>();
const localChildProcesses = new Map<number, LocalChildProcessRecord>();

const cloneChunkForKernel = (
	chunk: KernelStdioChunk | null | undefined
): KernelStdioChunk | null => {
	if (chunk === null || typeof chunk === 'undefined') {
		return null;
	}
	if (typeof chunk === 'string') {
		return chunk;
	}
	if (chunk instanceof Uint8Array) {
		return chunk.slice();
	}
	if (chunk instanceof ArrayBuffer) {
		return new Uint8Array(chunk);
	}
	if (ArrayBuffer.isView(chunk)) {
		const view = chunk as ArrayBufferView;
		return new Uint8Array(
			view.buffer,
			view.byteOffset,
			view.byteLength
		).slice();
	}
	return new Uint8Array(0);
};

const sendStdinToKernel = (
	pid: number,
	chunk: KernelStdioChunk | null | undefined,
	end = false
) => {
	if (!controlPort || typeof pid !== 'number' || pid <= 0) {
		return;
	}
	try {
		const cloned = cloneChunkForKernel(chunk);
		const transfer: ArrayBuffer[] = [];
		if (cloned instanceof Uint8Array) {
			transfer.push(cloned.buffer);
		}
		controlPort.postMessage(
			{
				type: CONTROL_MESSAGE_STDIN_DATA,
				pid,
				chunk: cloned,
				end: Boolean(end),
			},
			transfer
		);
	} catch {
		// Ignore failures while notifying kernel.
	}
};

const disposeFsClient = () => {
	if (!fsClient) {
		return;
	}
	try {
		fsClient.dispose();
	} catch {
		// Ignore failures during filesystem bridge cleanup.
	}
	fsClient = null;
};

const disposeSpawnSyncClient = () => {
	if (!spawnSyncClient) {
		return;
	}
	try {
		spawnSyncClient.dispose();
	} catch {
		// Ignore failures during spawnSync bridge cleanup.
	}
	spawnSyncClient = null;
};

const failAllPendingSpawnRequests = (reason: string | Error) => {
	const error =
		reason instanceof Error
			? reason
			: new Error(reason || 'Spawn request cancelled');
	for (const { reject } of pendingSpawnRequests.values()) {
		reject(error);
	}
	pendingSpawnRequests.clear();
};

const cleanupControlPort = (reason?: string) => {
	if (!controlPort) {
		return;
	}
	controlPort.removeEventListener('message', handleControlResponse);
	try {
		controlPort.close();
	} catch {
		// Ignore failures during control port cleanup.
	}
	controlPort = null;
	disposeFsClient();
	disposeSpawnSyncClient();
	failAllPendingSpawnRequests(
		reason ?? 'Control channel closed before spawn response'
	);
};

function handleControlResponse(event: MessageEvent) {
	const payload = event.data;
	if (!payload || typeof payload !== 'object') {
		return;
	}

	if (payload.type === CONTROL_MESSAGE_SPAWN_RESULT) {
		const requestId = payload.requestId;
		if (typeof requestId !== 'number') {
			return;
		}
		const pending = pendingSpawnRequests.get(requestId);
		if (!pending) {
			return;
		}
		pendingSpawnRequests.delete(requestId);

		if (payload.error) {
			const message =
				typeof payload.error.message === 'string' &&
				payload.error.message.length > 0
					? payload.error.message
					: typeof payload.error.code === 'number'
					? `Spawn failed with exit code ${payload.error.code}`
					: 'Spawn failed';
			pending.reject(new Error(message));
			return;
		}

		const result = payload.result as SpawnPlanMessage | undefined;
		if (!result) {
			pending.reject(new Error('Spawn result missing payload'));
			return;
		}

		try {
			const handle = createChildProcessHandle(result, pending.options);
			pending.resolve(handle);
		} catch (error) {
			pending.reject(
				error instanceof Error
					? error
					: new Error(
							String(error ?? 'Failed to create child process')
					  )
			);
		}
	} else if (payload.type === CONTROL_MESSAGE_KILL_RESULT) {
		// Kill acknowledgements are handled implicitly by exit notifications.
	} else if (payload.type === CONTROL_MESSAGE_CHILD_EXIT) {
		const pid = payload.pid;
		if (typeof pid !== 'number') {
			return;
		}
		const record = localChildProcesses.get(pid);
		if (!record) {
			return;
		}
		const code =
			typeof payload.code === 'number'
				? payload.code
				: record.handle.exitCode ?? 0;
		record.setExitCode(code);
		localChildProcesses.delete(pid);
	} else if (payload.type === CONTROL_MESSAGE_HOST_KILL_CHILD) {
		const pid = payload.pid;
		if (typeof pid !== 'number') {
			return;
		}
		const record = localChildProcesses.get(pid);
		if (!record) {
			return;
		}
		record.worker.terminate();
		record.setExitCode(1);
		localChildProcesses.delete(pid);
		reportChildExitToKernel(pid, 1);
	}
}

export async function initChildProcess(options: ChildProcessInitOptions) {
	const clonedOptions: ChildProcessInitOptions = {
		...options,
		argv: [...options.argv],
		env: { ...options.env },
		messagePort: options.messagePort,
		threadId: options.threadId,
		threadName: options.threadName,
	};

	stdioStreams?.stdin.destroy();
	stdioStreams?.stdout.destroy();
	stdioStreams?.stderr.destroy();

	stdioStreams = createChildStdio(clonedOptions.stdio);
	childProcessState = clonedOptions;

	cleanupControlPort('reinitializing control channel');
	controlPort = options.controlPort;
	controlPort.addEventListener('message', handleControlResponse);
	controlPort.start();

	disposeFsClient();
	fsClient = await createFsClient(clonedOptions, stdioStreams);
	const processFs = createProcessControllerFs(
		fsClient!,
		() => childProcessState?.cwd ?? clonedOptions.cwd
	);
	disposeSpawnSyncClient();
	spawnSyncClient = createSpawnSyncClient(options.spawnSyncPort);

	const processController = {
		argv() {
			return [...childProcessState!.argv];
		},
		cwd() {
			return childProcessState!.cwd;
		},
		chdir(path: string) {
			childProcessState!.cwd = path;
		},
		getEnv(name: string) {
			return childProcessState!.env[name] ?? '';
		},
		setEnv(name: string, value: string) {
			childProcessState!.env[name] = value;
		},
		getAllEnv() {
			return { ...childProcessState!.env };
		},
		pid() {
			return childProcessState!.pid;
		},
		executablePath() {
			return childProcessState!.programPath;
		},
		spawn(spawnOptions: ProcessControllerSpawnOptions) {
			const normalized = normalizeSpawnOptions(spawnOptions, {
				env: childProcessState?.env,
				cwd: childProcessState?.cwd,
				debug: childProcessState?.debug,
			});
			if (!normalized) {
				throw new Error('Invalid spawn options');
			}
			return requestSpawnFromKernel(normalized);
		},
		spawnSync(spawnOptions: ProcessControllerSpawnOptions) {
			if (!spawnSyncClient) {
				throw new Error('spawnSync bridge is not initialized');
			}
			const normalized = normalizeSpawnOptions(spawnOptions, {
				env: childProcessState?.env,
				cwd: childProcessState?.cwd,
				debug: childProcessState?.debug,
			});
			if (!normalized) {
				throw new Error('Invalid spawn options');
			}
			const adjusted: NormalizedSpawnOptions = {
				...normalized,
				stdio: {
					stdin: normalized.stdio?.stdin ?? 'ignore',
					stdout: 'pipe',
					stderr: 'pipe',
				},
			};
			adjusted.timeout = normalized.timeout;
			return spawnSyncClient.run(adjusted, normalized.timeout);
		},
		stdin: stdioStreams.stdin,
		stdout: stdioStreams.stdout,
		stderr: stdioStreams.stderr,
		messagePort: options.messagePort ?? null,
		threadId() {
			return clonedOptions.threadId ?? null;
		},
		threadName() {
			return clonedOptions.threadName ?? null;
		},
		fs: processFs,
		fsSync: processFs.sync,
		notifyKernelStdin(
			pid: number,
			chunk: KernelStdioChunk | null | undefined,
			end = false
		) {
			sendStdinToKernel(pid, chunk, end);
		},
		exit(code: number) {
			const pid = childProcessState?.pid ?? -1;
			// console.error('[processController.exit] CALLED! PID:', pid, 'code:', code);
			// console.log('[processController.exit] PID:', pid, 'code:', code);
			// Give all the streams and async actions chance to flush.
			setTimeout(() => {
				// console.error('[processController.exit] In setTimeout, sending exit message');

				// Send debug log to parent before exiting
				try {
					const debugLog = (globalThis as any).__mpDebug;
					if (Array.isArray(debugLog) && debugLog.length > 0) {
						self.postMessage({
							type: '__debug_log__',
							data: debugLog,
						});
					}
				} catch {}

				if (controlPort) {
					try {
						controlPort.postMessage({
							type: CONTROL_MESSAGE_PROCESS_EXIT,
							pid: childProcessState?.pid ?? 0,
							code,
						});
					} catch {
						// Ignore failures when notifying kernel about exit.
					}
				}

				cleanupControlPort('process exiting');
				stdioStreams?.stdout.end();
				stdioStreams?.stderr.end();
				self.postMessage({ type: 'exit', data: code });
				self.close();
			});
		},
	};

	(globalThis as any).processController = processController;
	(globalThis as any).__kernelProcessMessagePort =
		options.messagePort ?? null;
	(globalThis as any).__kernelProcessThreadId =
		typeof options.threadId === 'number' ? options.threadId : null;
	(globalThis as any).__kernelProcessThreadName =
		typeof options.threadName === 'string' ? options.threadName : null;
}

export function redirectConsoleToStdio(isDebug: boolean) {
	if (!stdioStreams) {
		throw new Error('installStdIo called before initChildProcess');
	}

	const originalConsole = (globalThis as any).originalConsole;
	(globalThis as any).__webPolyfillsOriginalConsole = originalConsole;

	const joinArgs = (args: unknown[]) =>
		args
			.map((arg) => {
				const chunk = toKernelChunk(arg);
				return typeof chunk === 'string'
					? chunk
					: `[Uint8Array(${chunk.byteLength})]`;
			})
			.join(' ');

	const writeStdout = (...args: unknown[]) => {
		if (isDebug) {
			originalConsole.log(...args);
		}
		const value = joinArgs(args);
		if (value.includes('[vite]')) {
			return;
		}
		const chunk = appendTrailingNewlineIfText(toKernelChunk(value));
		stdioStreams!.stdout.write(chunk);
	};

	const writeStderr = (...args: unknown[]) => {
		if (isDebug) {
			originalConsole.error(...args);
		}
		const value = joinArgs(args);
		if (value.includes('[vite]')) {
			return;
		}
		const chunk = appendTrailingNewlineIfText(toKernelChunk(value));
		stdioStreams!.stderr.write(chunk);
	};

	globalThis.console = {
		...originalConsole,
		log: writeStdout,
		info: writeStdout,
		debug: writeStdout,
		warn: writeStderr,
		error: writeStderr,
	};
}

const KERNEL_INIT_MESSAGE = '__kernel_internal__/initChildProcess';

const handleKernelInit = async (event: MessageEvent) => {
	if (bootstrapComplete) {
		return;
	}
	if (event.data?.type !== KERNEL_INIT_MESSAGE) {
		return;
	}

	bootstrapComplete = true;
	self.removeEventListener('message', handleKernelInit);

	const payload = event.data.payload as ChildProcessInitOptions;
	// Log stdio descriptors received by worker (use both console.log and originalConsole)
	await initChildProcess(payload);
	redirectConsoleToStdio(payload.debug);

	// Log stdio configuration AFTER console is redirected so we can see it
	// console.log('[BINARY after init] stdio descriptors received:', stdioInfo);
	// console.log(
	// 	'[BINARY after init] stdin stream type:',
	// 	(globalThis as any).processController?.stdin?.constructor?.name ||
	// 		'unknown'
	// );

	queueMicrotask(() => startProgram(payload));
};

self.addEventListener('message', handleKernelInit);

const stripShebang = (source: string): string => {
	if (source.startsWith('#!')) {
		const newlineIndex = source.indexOf('\n');
		if (newlineIndex === -1) {
			return '';
		}
		return source.slice(newlineIndex + 1);
	}
	return source;
};

const dirnameFromPath = (path: string): string => {
	if (!path || path === '/') {
		return '/';
	}
	const segments = path.split('/');
	segments.pop();
	const dir = segments.join('/');
	return dir.length > 0 ? dir : '/';
};

const reportProgramError = (error: unknown) => {
	const message =
		error instanceof Error ? error.stack ?? error.message : String(error);
	try {
		stdioStreams?.stderr.write(
			message.endsWith('\n') ? message : message + '\n'
		);
	} catch {
		// Ignore errors while reporting program error.
	}
	try {
		(globalThis as any).processController.exit(1);
	} catch {
		// Ignore failures during forced exit.
	}
};

const startProgram = async (options: ChildProcessInitOptions) => {
	if (programStarted) {
		return;
	}
	programStarted = true;

	if (!childProcessState || !stdioStreams) {
		throw new Error('executeProgram called before initialization');
	}

	const originalFilename = (globalThis as any).__filename;
	const originalDirname = (globalThis as any).__dirname;

	try {
		// Somehow this makes all the sync calls work in the imported module.
		// Without it, they hang indefinitely.
		// @TODO: Look into initialization flows, most likely,
		// there's a missing await between something is initialized and
		// Atomics.wait() is called.
		await (globalThis as any).processController.fs.readdir('/');

		// Vite is stubborn and wraps dynamic imports with a __vite__injectQuery call.
		// that adds a query parameter. Vite assumes that function exists in the worker.
		// In our case, it does not exist, so we need to provide a dummy implementation.
		(globalThis as any).__vite__injectQuery = (url: string): string => url;
		(globalThis as any).__filename = options.programPath;
		(globalThis as any).__dirname = dirnameFromPath(options.programPath);

		let programBody = stripShebang(options.programSource);

		// Support CJS exports:
		const moduleKey = `module-${Math.random()
			.toString(36)
			.substring(2, 15)}`;
		globalThis[moduleKey] = {};
		programBody =
			`const module = globalThis[${JSON.stringify(moduleKey)}];` +
			programBody;

		// // Write program body to OPFS for better debugging and source maps
		// try {
		// 	const opfsRoot = await navigator.storage.getDirectory();
		// 	const programFileName = `${moduleKey}.js`;
		// 	const fileHandle = await opfsRoot.getFileHandle(programFileName, {
		// 		create: true,
		// 	});
		// 	const writable = await fileHandle.createWritable();
		// 	await writable.write(programBody);
		// 	await writable.close();
		// } catch (opfsError) {
		// 	// OPFS write failed, continue with data URL approach
		// 	console.warn(
		// 		'[controller] Failed to write program to OPFS:',
		// 		opfsError
		// 	);
		// }
		const dataUrl =
			'data:text/javascript;charset=utf-8,' +
			encodeURIComponent(programBody);
		/**
		 * We can choose here if we want CJS or ESM.
		 *
		 * * Regular eval() works for CJS, but not for ESM – it's not recognized as
		 *   a module and we can't use top-level imports or awaits.
		 * * ESM import() works for both.
		 *
		 * Let's go with import() and re-evaluate this decision later if needed
		 */
		let module = await import(/* @vite-ignore */ dataUrl);

		/**
		 * If `module` has no exports but we've detected changes to the `module` object,
		 * Use the global `module` object instead.
		 */
		if (Object.keys(globalThis[moduleKey]).length > 0) {
			module = {
				...(globalThis[moduleKey]?.exports ?? {}),
				default: globalThis[moduleKey]?.exports ?? (() => {}),
			};
		}

		// Execute the program's main function
		if (typeof module.default === 'function') {
			try {
				const exitCode = await module.default(
					(globalThis as any).processController
				);
				if (typeof exitCode === 'number') {
					(globalThis as any).processController.exit(exitCode);
				} else {
					(globalThis as any).processController.exit(0);
				}
			} catch (moduleError) {
				console.error(
					'[controller] ERROR calling/awaiting module.default():',
					moduleError
				);
				console.error('[controller] Error type:', typeof moduleError);
				console.error(
					'[controller] Error message:',
					moduleError instanceof Error
						? moduleError.message
						: String(moduleError)
				);
				throw moduleError;
			}
		} else {
			// If no default export, the module executed at import time
			// Exit with success
			(globalThis as any).processController.exit(0);
		}
	} catch (error) {
		console.error('[controller] CAUGHT ERROR in try block:', error);
		reportProgramError(error);
	} finally {
		if (typeof originalFilename === 'undefined') {
			delete (globalThis as any).__filename;
		} else {
			(globalThis as any).__filename = originalFilename;
		}
		if (typeof originalDirname === 'undefined') {
			delete (globalThis as any).__dirname;
		} else {
			(globalThis as any).__dirname = originalDirname;
		}
	}
};

function requestSpawnFromKernel(
	options: NormalizedSpawnOptions
): Promise<ChildProcessHandle> {
	if (!controlPort || !childProcessState) {
		return Promise.reject(
			new Error('processController.spawn is not available')
		);
	}

	const port = controlPort;
	const requestId = nextSpawnRequestId++;

	return new Promise<ChildProcessHandle>((resolve, reject) => {
		pendingSpawnRequests.set(requestId, { options, resolve, reject });

		try {
			const transferList: MessagePort[] = [];
			if (options.ipcPort) {
				transferList.push(options.ipcPort);
			}
			port.postMessage(
				{
					type: CONTROL_MESSAGE_SPAWN_REQUEST,
					requestId,
					options,
				},
				transferList
			);
		} catch (error) {
			pendingSpawnRequests.delete(requestId);
			reject(
				error instanceof Error
					? error
					: new Error(String(error ?? 'Failed to request spawn'))
			);
		}
	});
}

function createChildProcessHandle(
	plan: SpawnPlanMessage,
	options: NormalizedSpawnOptions
): ChildProcessHandle {
	const transferList: MessagePort[] = [
		plan.controlPort,
		plan.fsPort,
		plan.spawnSyncPort,
	];
	let parentStdin: MessagePortWritableStream | undefined;
	let parentStdout: MessagePortReadableStream | undefined;
	let parentStderr: MessagePortReadableStream | undefined;

	for (const descriptor of plan.stdio) {
		// console.log(
		// 	'[spawn plan stdio] fd:',
		// 	descriptor.fd,
		// 	'mode:',
		// 	descriptor.mode,
		// 	'hasParentPort:',
		// 	!!descriptor.parentPort,
		// 	'hasWorkerPort:',
		// 	!!descriptor.workerPort
		// );
		if (descriptor.workerPort) {
			transferList.push(descriptor.workerPort);
		}
		if (descriptor.mode === 'pipe' && descriptor.fd === 0) {
			// Always create stdin - either with MessagePort if available, or null stream for control-port-only
			// console.log(
			// 	'[spawn plan] Creating parentStdin stream, hasParentPort:',
			// 	!!descriptor.parentPort
			// );
			// For nested spawns, parentPort will be null, but we still need stdin property on handle
			// Wrapping below will forward via control port
			parentStdin = descriptor.parentPort
				? new MessagePortWritableStream(descriptor.parentPort)
				: (new NullWritableStream() as any);
		} else if (
			descriptor.mode === 'pipe' &&
			descriptor.parentPort &&
			descriptor.fd === 1
		) {
			// console.log('[spawn plan] Creating parentStdout stream');
			parentStdout = new MessagePortReadableStream(
				descriptor.parentPort,
				{ debugLabel: 'parent:stdout' }
			);
		} else if (
			descriptor.mode === 'pipe' &&
			descriptor.parentPort &&
			descriptor.fd === 2
		) {
			// console.log('[spawn plan] Creating parentStderr stream');
			parentStderr = new MessagePortReadableStream(
				descriptor.parentPort,
				{ debugLabel: 'parent:stderr' }
			);
		}
	}

	if (parentStdin) {
		const originalWrite = parentStdin.write.bind(parentStdin);
		parentStdin.write = (chunk: KernelStdioChunk) => {
			// Call originalWrite FIRST to clone the chunk, then send to kernel
			// sendStdinToKernel transfers the buffer which detaches it
			const result = originalWrite(chunk);
			sendStdinToKernel(plan.pid, chunk, false);
			return result;
		};
		const originalEnd =
			typeof parentStdin.end === 'function'
				? parentStdin.end.bind(parentStdin)
				: null;
		if (originalEnd) {
			parentStdin.end = (chunk?: KernelStdioChunk) => {
				// Call originalEnd FIRST to clone the chunk, then send to kernel
				// sendStdinToKernel transfers the buffer which detaches it
				const result = originalEnd(chunk);
				if (typeof chunk !== 'undefined') {
					sendStdinToKernel(plan.pid, chunk, false);
				}
				sendStdinToKernel(plan.pid, null, true);
				return result;
			};
		}
		const originalDestroy =
			typeof parentStdin.destroy === 'function'
				? parentStdin.destroy.bind(parentStdin)
				: null;
		if (originalDestroy) {
			parentStdin.destroy = () => {
				sendStdinToKernel(plan.pid, null, true);
				originalDestroy();
			};
		}
	}

	if (plan.messagePort?.workerPort) {
		transferList.push(plan.messagePort.workerPort);
	}

	const parentMessagePort = plan.messagePort?.parentPort ?? null;

	const threadId = options.workerThreadId ?? plan.threadId ?? plan.pid;
	const threadName =
		options.workerThreadName ?? plan.threadName ?? `worker-${threadId}`;

	const worker = createProcessWorker();

	const exitListeners = new Set<ExitListener>();
	let exitCode: number | null = null;

	const handle: ChildProcessHandle = {
		pid: plan.pid,
		stdin: parentStdin,
		stdout: parentStdout,
		stderr: parentStderr,
		messagePort: parentMessagePort ?? undefined,
		threadId,
		threadName,
		onExit(listener: ExitListener) {
			if (exitCode !== null) {
				try {
					listener(exitCode);
				} catch {
					// Ignore listener failures if process already exited.
				}
				return;
			}
			exitListeners.add(listener);
		},
		offExit(listener: ExitListener) {
			exitListeners.delete(listener);
		},
		kill() {
			if (!controlPort) {
				return;
			}
			try {
				controlPort.postMessage({
					type: CONTROL_MESSAGE_KILL_REQUEST,
					pid: plan.pid,
					requestId: null,
				});
			} catch {
				// Ignore failures dispatching kill request.
			}
		},
		get exitCode() {
			return exitCode;
		},
	};

	const setExitCode = (code: number) => {
		if (exitCode !== null) {
			return;
		}
		exitCode = code;
		try {
			parentStdin?.destroy();
		} catch {
			// Ignore stream cleanup errors.
		}
		try {
			parentStdout?.destroy();
		} catch {
			// Ignore stream cleanup errors.
		}
		try {
			parentStderr?.destroy();
		} catch {
			// Ignore stream cleanup errors.
		}
		for (const listener of Array.from(exitListeners)) {
			try {
				listener(code);
			} catch {
				// Ignore listener failures.
			}
		}
		exitListeners.clear();
	};

	localChildProcesses.set(plan.pid, {
		handle,
		worker,
		exitListeners,
		setExitCode,
	});

	worker.addEventListener('message', (event: MessageEvent) => {
		const payload = event.data;
		if (payload && typeof payload === 'object' && payload.type === 'exit') {
			const code =
				typeof payload.data === 'number' ? payload.data : exitCode ?? 0;
			setExitCode(code);
		} else if (
			payload &&
			typeof payload === 'object' &&
			payload.type === '__debug_log__'
		) {
			// Store worker debug logs in parent's globalThis for inspection
			if (!(globalThis as any).__workerDebugLogs) {
				(globalThis as any).__workerDebugLogs = {};
			}
			(globalThis as any).__workerDebugLogs[plan.pid] = payload.data;
		}
	});

	worker.addEventListener('error', () => {
		setExitCode(1);
		reportChildExitToKernel(plan.pid, 1);
	});

	// Create stdio descriptors for init message
	const stdioForInit = plan.stdio.map((descriptor) => ({
		fd: descriptor.fd,
		mode: descriptor.mode,
		port: descriptor.workerPort ?? undefined,
	}));

	const initMessage = {
		type: '__kernel_internal__/initChildProcess',
		payload: {
			pid: plan.pid,
			argv: [...options.argv],
			env: { ...options.env },
			cwd: options.cwd,
			debug: Boolean(options.debug),
			stdio: stdioForInit,
			programPath: plan.programPath,
			programSource: plan.programSource,
			controlPort: plan.controlPort,
			fsPort: plan.fsPort,
			spawnSyncPort: plan.spawnSyncPort,
			messagePort: plan.messagePort?.workerPort ?? null,
			threadId,
			threadName,
			fsType: plan.fsType,
		},
	};

	// console.log(
	// 	'[createChildProcessHandle] transferList has',
	// 	transferList.length,
	// 	'ports'
	// );
	worker.postMessage(initMessage, transferList);

	return handle;
}

function reportChildExitToKernel(pid: number, code: number) {
	if (!controlPort) {
		return;
	}
	try {
		controlPort.postMessage({
			type: CONTROL_MESSAGE_REPORT_CHILD_EXIT,
			pid,
			code,
		});
	} catch {
		// Ignore failures when informing kernel about exit.
	}
}
