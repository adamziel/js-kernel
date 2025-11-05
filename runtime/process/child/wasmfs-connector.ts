import type { KernelStdioChunk } from '../../ipc/message-port.ts';
import type { WasmFSModule } from '../../wasmfs-types.ts';

export interface KernelFsClient {
	async: Record<string, (...args: unknown[]) => Promise<unknown>>;
	sync: Record<string, (...args: unknown[]) => unknown>;
	writeToStdout?(chunk: KernelStdioChunk): void;
	writeToStderr?(chunk: KernelStdioChunk): void;
	dispose(): void;
}

interface StdioStreams {
	stdin: {
		read(): unknown;
		isClosed(): boolean;
		isEnded(): boolean;
		destroy(): void;
	};
	stdout: { write(chunk: KernelStdioChunk): boolean; destroy(): void };
	stderr: { write(chunk: KernelStdioChunk): boolean; destroy(): void };
}

// File flags (Linux/Emscripten standard)
const O_RDONLY = 0;
const O_WRONLY = 1;
const O_RDWR = 2;
const O_CREAT = 0x40;
const O_EXCL = 0x80;
const O_TRUNC = 0x200;
const O_APPEND = 0x400;

// Seek whence values
const SEEK_SET = 0;
const SEEK_CUR = 1;
const SEEK_END = 2;

// File type bit masks
const S_IFMT = 0o170000;
const S_IFIFO = 0o010000;
const S_IFCHR = 0o020000;
const S_IFDIR = 0o040000;
const S_IFBLK = 0o060000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
const S_IFSOCK = 0o140000;

const STAT_STRUCT_SIZE = 96;

// Access modes
const F_OK = 0;
const R_OK = 4;
const W_OK = 2;
const X_OK = 1;

// Singleton module instance shared across all connectors in the same worker
let sharedModulePromise: Promise<WasmFSModule> | null = null;
let sharedModule: WasmFSModule | null = null;

const getSharedModule = async (): Promise<WasmFSModule> => {
	if (sharedModule) {
		return sharedModule;
	}

	if (!sharedModulePromise) {
		sharedModulePromise = (async () => {
			const createWasmFSModule = (
				await import('../../wasmfs-dist/wasmfs-fs.js')
			).default;
			const module = (await createWasmFSModule()) as unknown as WasmFSModule;

			// Initialize OPFS
			const result = module._fs_init();
			if (result !== 0) {
				throw new Error('Failed to initialize WASMFS');
			}

			sharedModule = module;
			return module;
		})();
	}

	return sharedModulePromise;
};

// Helper functions
function normalizePath(path: string): string {
	// Prepend /opfs to all absolute paths to use OPFS backend
	// This makes /a actually go to /opfs/a while appearing as /a to the user
	if (path.startsWith('/') && !path.startsWith('/opfs')) {
		return '/opfs' + path;
	}
	return path;
}

function denormalizePath(path: string): string {
	if (path === '/opfs' || path === '/opfs/') {
		return '/';
	}
	if (path.startsWith('/opfs/')) {
		const trimmed = path.slice(5);
		return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
	}
	return path;
}

function normalizeAndTrim(path: string): string {
	const normalized = normalizePath(path);
	if (normalized.length > 1 && normalized.endsWith('/')) {
		return normalized.replace(/\/+$/, '');
	}
	return normalized;
}

const normalizeReadFileOptions = (
	options: unknown
): { encoding?: string; flag?: string } => {
	if (typeof options === 'string') {
		return { encoding: options };
	}
	if (options && typeof options === 'object') {
		const candidate = options as { encoding?: unknown; flag?: unknown };
		return {
			encoding:
				typeof candidate.encoding === 'string'
					? candidate.encoding
					: undefined,
			flag:
				typeof candidate.flag === 'string' ? candidate.flag : undefined,
		};
	}
	return {};
};

const normalizeWriteFileOptions = (
	options: unknown
): { encoding?: string; mode?: number; flag?: string } => {
	if (typeof options === 'string') {
		return { encoding: options };
	}
	if (options && typeof options === 'object') {
		const candidate = options as {
			encoding?: unknown;
			mode?: unknown;
			flag?: unknown;
		};
		return {
			encoding:
				typeof candidate.encoding === 'string'
					? candidate.encoding
					: undefined,
			mode:
				typeof candidate.mode === 'number' ? candidate.mode : undefined,
			flag:
				typeof candidate.flag === 'string' ? candidate.flag : undefined,
		};
	}
	return {};
};

const toUnixTimestampSeconds = (value: number | string | Date): number => {
	if (value instanceof Date) {
		return value.getTime() / 1000;
	}
	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : Date.now() / 1000;
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	return Date.now() / 1000;
};

const ensureDirectoryRecursive = (
	module: WasmFSModule,
	targetPath: string,
	mode: number,
	errnoNames: Map<number, string>
) => {
	const normalized = normalizeAndTrim(targetPath);
	if (normalized === '/' || normalized === '') {
		return;
	}
	const segments = normalized.split('/').filter(Boolean);
	let current = normalized.startsWith('/') ? '' : normalized;
	for (let index = 0; index < segments.length; index += 1) {
		current += `/${segments[index]}`;
		const currentPtr = allocString(module, current);
		const result = module._fs_mkdir(currentPtr, mode);
		module._free(currentPtr);
		if (result < 0) {
			const errno = module._fs_get_errno();
			const errnoName = errnoNames.get(errno);
			if (errnoName === 'EEXIST') {
				continue;
			}
			throw createFsError('mkdir', denormalizePath(current), errno);
		}
	}
};

function allocString(module: WasmFSModule, str: string): number {
	const len = module.lengthBytesUTF8(str) + 1;
	const ptr = module._malloc(len);
	module.stringToUTF8(str, ptr, len);
	return ptr;
}

function readString(module: WasmFSModule, ptr: number): string {
	return module.UTF8ToString(ptr);
}

function toUint8Array(chunk: unknown): Uint8Array {
	if (chunk instanceof Uint8Array) {
		return chunk;
	}
	if (typeof chunk === 'string') {
		return new TextEncoder().encode(chunk);
	}
	if (chunk instanceof ArrayBuffer) {
		return new Uint8Array(chunk);
	}
	if (ArrayBuffer.isView(chunk)) {
		const view = chunk as ArrayBufferView;
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}
	return new Uint8Array(0);
}

export const createWasmFsKernelConnector = async (
	stdio?: StdioStreams
): Promise<KernelFsClient> => {
	const module = await getSharedModule();
	let disposed = false;

	// File descriptor mapping: Node.js fd -> WASMFS fd
	const fdMap = new Map<number, number>();
	let nextFd = 3; // Start from 3 (0,1,2 are stdin/stdout/stderr)

	const errnoNames = new Map<number, string>();
	for (const [name, value] of Object.entries(module.ERRNO_CODES ?? {})) {
		if (typeof value === 'number') {
			errnoNames.set(value, name);
		}
	}

	const createFsError = (operation: string, path: string, errno: number) => {
		const errnoName = errnoNames.get(errno) ?? 'Error';
		return new Error(
			`${errnoName}: ${operation} '${path}' (errno: ${errno})`
		);
	};

	const toTimestampMs = (seconds: unknown): number =>
		typeof seconds === 'number' ? seconds * 1000 : 0;

	const createStatResult = (stat: Record<string, unknown>) => {
		const mode = Number(stat.mode ?? 0) >>> 0;
		const atimeMs = toTimestampMs(stat.atime);
		const mtimeMs = toTimestampMs(stat.mtime);
		const ctimeMs = toTimestampMs(stat.ctime);

		const base = {
			dev: Number(stat.dev ?? 0),
			mode,
			nlink: Number(stat.nlink ?? 0),
			uid: Number(stat.uid ?? 0),
			gid: Number(stat.gid ?? 0),
			rdev: Number(stat.rdev ?? 0),
			size: Number(stat.size ?? 0),
			blksize: Number(stat.blksize ?? 0),
			blocks: Number(stat.blocks ?? 0),
			ino: Number(stat.ino ?? 0),
			atimeMs,
			mtimeMs,
			ctimeMs,
			birthtimeMs: ctimeMs,
			atime: new Date(atimeMs),
			mtime: new Date(mtimeMs),
			ctime: new Date(ctimeMs),
			birthtime: new Date(ctimeMs),
		};

		const typeCheck = (type: number) => () => (mode & S_IFMT) === type;

		return {
			...base,
			isFile: typeCheck(S_IFREG),
			isDirectory: typeCheck(S_IFDIR),
			isSymbolicLink: typeCheck(S_IFLNK),
			isBlockDevice: typeCheck(S_IFBLK),
			isCharacterDevice: typeCheck(S_IFCHR),
			isFIFO: typeCheck(S_IFIFO),
			isSocket: typeCheck(S_IFSOCK),
			toJSON() {
				return {
					dev: base.dev,
					mode: base.mode,
					nlink: base.nlink,
					uid: base.uid,
					gid: base.gid,
					rdev: base.rdev,
					size: base.size,
					blksize: base.blksize,
					blocks: base.blocks,
					atimeMs: base.atimeMs,
					mtimeMs: base.mtimeMs,
					ctimeMs: base.ctimeMs,
					birthtimeMs: base.birthtimeMs,
					atime: base.atime,
					mtime: base.mtime,
					ctime: base.ctime,
					birthtime: base.birthtime,
					ino: base.ino,
				};
			},
		};
	};

	const readStatFromPointer = (statPtr: number) => {
		const statObject = module.FS.statBufToObject(statPtr);
		return createStatResult(statObject);
	};

	const resolveWasmFd = (fd: number): number => {
		if (fd >= 0 && fd <= 2) {
			return fd;
		}

		const wasmFd = fdMap.get(fd);
		if (wasmFd === undefined) {
			throw createFsError(
				'fstat',
				String(fd),
				module.ERRNO_CODES?.EBADF ?? 9
			);
		}
		return wasmFd;
	};

	const statPath = (path: string, lstat = false) => {
		const normalizedPath = normalizePath(path);
		const pathPtr = allocString(module, normalizedPath);
		const statPtr = module._malloc(STAT_STRUCT_SIZE);

		const result = lstat
			? module._fs_lstat(pathPtr, statPtr)
			: module._fs_stat(pathPtr, statPtr);

		module._free(pathPtr);

		if (result < 0) {
			const errno = module._fs_get_errno();
			module._free(statPtr);
			throw createFsError(lstat ? 'lstat' : 'stat', path, errno);
		}

		const stats = readStatFromPointer(statPtr);
		module._free(statPtr);
		return stats;
	};

	const fstatFd = (fd: number) => {
		const wasmFd = resolveWasmFd(fd);
		const statPtr = module._malloc(STAT_STRUCT_SIZE);
		const result = module._fs_fstat(wasmFd, statPtr);

		if (result < 0) {
			const errno = module._fs_get_errno();
			module._free(statPtr);
			throw createFsError('fstat', String(fd), errno);
		}

		const stats = readStatFromPointer(statPtr);
		module._free(statPtr);
		return stats;
	};

	// Map Node.js flags to WASMFS flags
	const parseFlagsString = (flags: string): number => {
		switch (flags) {
			case 'r':
				return O_RDONLY;
			case 'r+':
				return O_RDWR;
			case 'w':
				return O_WRONLY | O_CREAT | O_TRUNC;
			case 'w+':
				return O_RDWR | O_CREAT | O_TRUNC;
			case 'a':
				return O_WRONLY | O_CREAT | O_APPEND;
			case 'a+':
				return O_RDWR | O_CREAT | O_APPEND;
			case 'wx':
				return O_WRONLY | O_CREAT | O_TRUNC | O_EXCL;
			case 'wx+':
				return O_RDWR | O_CREAT | O_TRUNC | O_EXCL;
			case 'ax':
				return O_WRONLY | O_CREAT | O_APPEND | O_EXCL;
			case 'ax+':
				return O_RDWR | O_CREAT | O_APPEND | O_EXCL;
			default:
				return O_RDONLY;
		}
	};

	const parseFlags = (flags: unknown): number => {
		if (typeof flags === 'number') {
			return flags;
		}
		if (typeof flags === 'string') {
			return parseFlagsString(flags);
		}
		return O_RDONLY;
	};

	// Filesystem operations
	const operations = {
		// File operations
		openSync: (path: string, flags: unknown, mode?: number): number => {
			const normalizedPath = normalizePath(path);
			const pathPtr = allocString(module, normalizedPath);
			const wasmfsFlags = parseFlags(flags);
			const wasmfsFd = module._fs_open(pathPtr, wasmfsFlags, mode ?? 0o666);
			module._free(pathPtr);

			if (wasmfsFd < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('open', path, errno);
			}

			const nodeFd = nextFd++;
			fdMap.set(nodeFd, wasmfsFd);
			return nodeFd;
		},

		closeSync: (fd: number): void => {
			// Handle stdio descriptors
			if (fd === 0 || fd === 1 || fd === 2) {
				return;
			}

			const wasmfsFd = fdMap.get(fd);
			if (wasmfsFd === undefined) {
				throw createFsError('close', String(fd), module.ERRNO_CODES?.EBADF ?? 9);
			}

			const result = module._fs_close(wasmfsFd);
			fdMap.delete(fd);

			if (result < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('close', String(fd), errno);
			}
		},

		readSync: (fd: number, buffer: Uint8Array, offset?: number, length?: number, position?: number): number => {
			// Handle stdin
			if (fd === 0 && stdio) {
				const data = stdio.stdin.read();
				if (!data) return 0;
				const bytes = toUint8Array(data);
				const copyLength = Math.min(length ?? buffer.length, bytes.byteLength);
				buffer.set(bytes.subarray(0, copyLength), offset ?? 0);
				return copyLength;
			}

			const wasmfsFd = fdMap.get(fd);
			if (wasmfsFd === undefined) {
				throw createFsError('read', String(fd), module.ERRNO_CODES?.EBADF ?? 9);
			}

			if (position !== undefined && position !== null) {
				module._fs_lseek(wasmfsFd, BigInt(position), SEEK_SET);
			}

			const readLength = length ?? buffer.length;
			const bufPtr = module._malloc(readLength);
			const bytesRead = module._fs_read(wasmfsFd, bufPtr, readLength);

			if (bytesRead > 0) {
				const readData = new Uint8Array(module.HEAP8.buffer, bufPtr, bytesRead);
				buffer.set(readData, offset ?? 0);
			}

			module._free(bufPtr);
			return bytesRead;
		},

		writeSync: (fd: number, data: string | Uint8Array, offsetOrPos?: number, lengthOrEnc?: unknown, position?: unknown): number => {
			// Handle stdout/stderr
			if ((fd === 1 || fd === 2) && stdio) {
				const stream = fd === 1 ? stdio.stdout : stdio.stderr;
				const chunk = typeof data === 'string' ? data : data;
				stream.write(chunk);
				return typeof data === 'string' ? data.length : data.byteLength;
			}

			const wasmfsFd = fdMap.get(fd);
			if (wasmfsFd === undefined) {
				throw createFsError('write', String(fd), module.ERRNO_CODES?.EBADF ?? 9);
			}

			let bytes: Uint8Array;
			let writeLength: number;

			if (typeof data === 'string') {
				bytes = new TextEncoder().encode(data);
				writeLength = bytes.byteLength;
			} else {
				const offset = typeof offsetOrPos === 'number' ? offsetOrPos : 0;
				const length = typeof lengthOrEnc === 'number' ? lengthOrEnc : data.byteLength - offset;
				bytes = data.subarray(offset, offset + length);
				writeLength = bytes.byteLength;
			}

			const bufPtr = module._malloc(writeLength);
			new Uint8Array(module.HEAP8.buffer, bufPtr, writeLength).set(bytes);

			const bytesWritten = module._fs_write(wasmfsFd, bufPtr, writeLength);
			module._free(bufPtr);

			if (bytesWritten < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('write', String(fd), errno);
			}

			return bytesWritten;
		},

		readFileSync: (
			path: string,
			options?: { encoding?: string; flag?: string } | string
		): string | Uint8Array => {
			const normalizedOptions = normalizeReadFileOptions(options);
			const normalizedPath = normalizePath(path);
			const flags = parseFlags(normalizedOptions.flag ?? 'r');
			const pathPtr = allocString(module, normalizedPath);
			const fd = module._fs_open(pathPtr, flags, 0o666);
			module._free(pathPtr);

			if (fd < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('open', path, errno);
			}

			// Get file size
			const size = Number(module._fs_lseek(fd, 0n, SEEK_END));
			module._fs_lseek(fd, 0n, SEEK_SET);

			if (size === 0) {
				module._fs_close(fd);
				return normalizedOptions.encoding ? '' : new Uint8Array(0);
			}

			const bufPtr = module._malloc(size);
			const bytesRead = module._fs_read(fd, bufPtr, size);

			const result = new Uint8Array(module.HEAP8.buffer, bufPtr, bytesRead).slice();
			module._free(bufPtr);
			module._fs_close(fd);

			if (
				normalizedOptions.encoding === 'utf8' ||
				normalizedOptions.encoding === 'utf-8'
			) {
				return new TextDecoder().decode(result);
			}
			return result;
		},

		writeFileSync: (
			path: string,
			data: string | Uint8Array,
			options?: { encoding?: string; mode?: number; flag?: string } | string
		): void => {
			const normalizedOptions = normalizeWriteFileOptions(options);
			const normalizedPath = normalizePath(path);
			const flags = parseFlags(normalizedOptions.flag ?? 'w');
			const mode = normalizedOptions.mode ?? 0o666;
			const pathPtr = allocString(module, normalizedPath);
			const fd = module._fs_open(pathPtr, flags, mode);
			module._free(pathPtr);

			if (fd < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('open', path, errno);
			}

			const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
			const bufPtr = module._malloc(bytes.byteLength);
			new Uint8Array(module.HEAP8.buffer, bufPtr, bytes.byteLength).set(bytes);

			const bytesWritten = module._fs_write(fd, bufPtr, bytes.byteLength);
			module._free(bufPtr);

			if (bytesWritten < 0) {
				const errno = module._fs_get_errno();
				module._fs_close(fd);
				throw createFsError('write', path, errno);
			}

			module._fs_fsync(fd);
			module._fs_close(fd);
		},

		appendFileSync: (
			path: string,
			data: string | Uint8Array,
			options?: { encoding?: string; mode?: number; flag?: string } | string
		): void => {
			const normalizedOptions = normalizeWriteFileOptions(options);
			const normalizedPath = normalizePath(path);
			const flags = parseFlags(normalizedOptions.flag ?? 'a');
			const mode = normalizedOptions.mode ?? 0o666;
			const pathPtr = allocString(module, normalizedPath);
			const fd = module._fs_open(pathPtr, flags, mode);
			module._free(pathPtr);

			if (fd < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('open', path, errno);
			}

			const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
			const bufPtr = module._malloc(bytes.byteLength);
			new Uint8Array(module.HEAP8.buffer, bufPtr, bytes.byteLength).set(bytes);

			const bytesWritten = module._fs_write(fd, bufPtr, bytes.byteLength);
			module._free(bufPtr);

			if (bytesWritten < 0) {
				const errno = module._fs_get_errno();
				module._fs_close(fd);
				throw createFsError('write', path, errno);
			}

			module._fs_fsync(fd);
			module._fs_close(fd);
		},

		statSync: (path: string): any => {
			return statPath(path, false);
		},

		lstatSync: (path: string): any => {
			return statPath(path, true);
		},

		fstatSync: (fd: number): any => {
			return fstatFd(fd);
		},

		existsSync: (path: string): boolean => {
			const normalizedPath = normalizeAndTrim(path);
			const pathPtr = allocString(module, normalizedPath);
			const result = module._fs_access(pathPtr, F_OK);
			module._free(pathPtr);
			return result === 0;
		},

		mkdirSync: (path: string, options?: { recursive?: boolean; mode?: number }): void => {
			const mode = options?.mode ?? 0o777;
			if (options?.recursive) {
				ensureDirectoryRecursive(module, path, mode, errnoNames);
				return;
			}
			const normalizedPath = normalizeAndTrim(path);
			const pathPtr = allocString(module, normalizedPath);
			const result = module._fs_mkdir(pathPtr, mode);
			module._free(pathPtr);

			if (result < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('mkdir', path, errno);
			}
		},

		rmdirSync: (path: string): void => {
			const normalizedPath = normalizePath(path);
			const pathPtr = allocString(module, normalizedPath);
			const result = module._fs_rmdir(pathPtr);
			module._free(pathPtr);

			if (result < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('rmdir', path, errno);
			}
		},

		unlinkSync: (path: string): void => {
			const normalizedPath = normalizePath(path);
			const pathPtr = allocString(module, normalizedPath);
			const result = module._fs_unlink(pathPtr);
			module._free(pathPtr);

			if (result < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('unlink', path, errno);
			}
		},

		renameSync: (oldPath: string, newPath: string): void => {
			const normalizedOldPath = normalizePath(oldPath);
			const normalizedNewPath = normalizePath(newPath);
			const oldPathPtr = allocString(module, normalizedOldPath);
			const newPathPtr = allocString(module, normalizedNewPath);
			const result = module._fs_rename(oldPathPtr, newPathPtr);
			module._free(oldPathPtr);
			module._free(newPathPtr);

			if (result < 0) {
				const errno = module._fs_get_errno();
				throw createFsError(
					'rename',
					`${oldPath} -> ${newPath}`,
					errno
				);
			}
		},

		chmodSync: (path: string, mode: number): void => {
			const normalizedPath = normalizePath(path);
			const pathPtr = allocString(module, normalizedPath);
			const result = module._fs_chmod(pathPtr, mode);
			module._free(pathPtr);

			if (result < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('chmod', path, errno);
			}
		},

		accessSync: (path: string, mode?: number): void => {
			const normalizedPath = normalizePath(path);
			const checkMode = mode ?? F_OK;
			const pathPtr = allocString(module, normalizedPath);
			const result = module._fs_access(pathPtr, checkMode);
			module._free(pathPtr);

			if (result < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('access', path, errno);
			}
		},

		readdirSync: (path: string): string[] => {
			const normalizedPath = normalizePath(path);
			const pathPtr = allocString(module, normalizedPath);
			const dirp = module._fs_opendir(pathPtr);
			module._free(pathPtr);

			if (dirp === 0) {
				const errno = module._fs_get_errno();
				throw createFsError('readdir', path, errno);
			}

			const entries: string[] = [];
			try {
				while (true) {
					const direntPtr = module._fs_readdir(dirp);
					if (direntPtr === 0) {
						break;
					}

					// struct dirent layout:
					// - d_ino: 8 bytes (ino_t)
					// - d_off: 8 bytes (off_t)
					// - d_reclen: 2 bytes (unsigned short)
					// - d_type: 1 byte (unsigned char)
					// - d_name: 256 bytes (char array)
					// Total offset to d_name: 19 bytes

					// Read the name using Emscripten's UTF8ToString helper
					const nameOffset = direntPtr + 19;
					const name = module.UTF8ToString(nameOffset);

					// Skip . and ..
					if (name && name !== '.' && name !== '..') {
						entries.push(name);
					}
				}
			} finally {
				module._fs_closedir(dirp);
			}

			return entries;
		},

		truncateSync: (path: string, length: number): void => {
			const normalizedPath = normalizePath(path);
			const pathPtr = allocString(module, normalizedPath);
			const result = module._fs_truncate(pathPtr, BigInt(length));
			module._free(pathPtr);

			if (result < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('truncate', path, errno);
			}
		},

		ftruncateSync: (fd: number, length: number): void => {
			const wasmfsFd = fdMap.get(fd);
			if (wasmfsFd === undefined) {
				throw createFsError('ftruncate', String(fd), module.ERRNO_CODES?.EBADF ?? 9);
			}

			const result = module._fs_ftruncate(wasmfsFd, BigInt(length));
			if (result < 0) {
				const errno = module._fs_get_errno();
				throw createFsError('ftruncate', String(fd), errno);
			}
		},

		utimesSync: (
			path: string,
			atime: number | string | Date,
			mtime: number | string | Date
		): void => {
			const normalizedPath = normalizePath(path);
			try {
				module.FS.utime(
					normalizedPath,
					toUnixTimestampSeconds(atime),
					toUnixTimestampSeconds(mtime)
				);
			} catch (error) {
				const errno = module._fs_get_errno();
				throw createFsError('utimes', path, errno);
			}
		},

		rmSync: (
			path: string,
			options?: { force?: boolean; recursive?: boolean; maxRetries?: number; retryDelay?: number }
		): void => {
			const normalizedPath = normalizePath(path);
			let stats;
			try {
				stats = statPath(path, true);
			} catch (error) {
				if (options?.force) {
					return;
				}
				throw error;
			}
			if (stats.isDirectory()) {
				if (!options?.recursive) {
					throw createFsError(
						'rm',
						`${path} (is a directory)`,
						module.ERRNO_CODES?.EISDIR ?? 21
					);
				}
				const entries = operations.readdirSync(path);
				for (const entry of entries) {
					let childPath = path.endsWith('/') ? `${path}${entry}` : `${path}/${entry}`;
					operations.rmSync(childPath, options);
				}
				const pathPtr = allocString(module, normalizedPath);
				const result = module._fs_rmdir(pathPtr);
				module._free(pathPtr);
				if (result < 0 && !options?.force) {
					const errno = module._fs_get_errno();
					throw createFsError('rm', path, errno);
				}
				return;
			}
			const pathPtr = allocString(module, normalizedPath);
			const result = module._fs_unlink(pathPtr);
			module._free(pathPtr);
			if (result < 0 && !options?.force) {
				const errno = module._fs_get_errno();
				throw createFsError('rm', path, errno);
			}
		},
	};

	// Create async versions by wrapping sync operations
	const asyncOperations: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

	for (const [name, fn] of Object.entries(operations)) {
		const asyncName = name.replace('Sync', '');
		asyncOperations[asyncName] = async (...args: unknown[]) => {
			return fn(...args);
		};
		// Also expose with Async suffix
		asyncOperations[asyncName + 'Async'] = asyncOperations[asyncName];
		// And keep the Sync version
		asyncOperations[name] = async (...args: unknown[]) => {
			return fn(...args);
		};
	}

	const syncProxy = new Proxy(operations, {
		get(target, property) {
			if (typeof property === 'string' && property in target) {
				return target[property as keyof typeof target];
			}
			return undefined;
		},
	});

	const asyncProxy = new Proxy(asyncOperations, {
		get(target, property) {
			if (property === 'then' || property === 'promises') {
				return undefined;
			}
			if (typeof property === 'string' && property in target) {
				return target[property];
			}
			return undefined;
		},
	});

	(asyncProxy as any).promises = asyncProxy;

	const dispose = () => {
		if (disposed) {
			return;
		}
		disposed = true;

		// Close all open file descriptors
		for (const [nodeFd, wasmfsFd] of fdMap.entries()) {
			try {
				module._fs_close(wasmfsFd);
			} catch {
				// Ignore errors during cleanup
			}
		}
		fdMap.clear();

		// Note: We don't dispose the shared module as other connectors may be using it
	};

	return {
		async: asyncProxy,
		sync: syncProxy,
		dispose,
	};
};
