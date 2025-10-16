globalThis.primordials = {};
globalThis.global = globalThis;
import * as builtins from './builtins.js';
// @TODO: Do not rely on `window` here. We're running a Node.js process after all.
globalThis.window = globalThis.global = globalThis;
globalThis.globalFs = processController.fsSync;

const UTF8_DECODER = new TextDecoder('utf-8');
const READ_FILE_UTF8_CHUNK_SIZE = 64 * 1024;

function readUtf8FromFileDescriptor(fd) {
	const chunks = [];
	while (true) {
		const chunk = globalFs.readSync(fd, READ_FILE_UTF8_CHUNK_SIZE, null);
		if (!chunk || chunk.byteLength === 0) {
			break;
		}
		chunks.push(
			chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
		);
		if (chunk.byteLength < READ_FILE_UTF8_CHUNK_SIZE) {
			break;
		}
	}

	if (chunks.length === 0) {
		return '';
	}

	if (chunks.length === 1) {
		return UTF8_DECODER.decode(chunks[0]);
	}

	const totalLength = chunks.reduce(
		(sum, chunk) => sum + chunk.byteLength,
		0
	);
	const merged = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return UTF8_DECODER.decode(merged);
}

// Global module registry for built modules to register their exports
// This allows defineLazyProperties to access internal modules
globalThis.__moduleRegistry = new Map();

function maybePromiseFromSync(syncFn, kUsePromisesOrReq) {
	// Sync call
	if (kUsePromisesOrReq === undefined) {
		return syncFn();
	}
	const promise = new Promise((resolve, reject) => {
		try {
			resolve(syncFn());
		} catch (err) {
			reject(err);
		}
	});

	// Callback mode
	if (
		kUsePromisesOrReq &&
		typeof kUsePromisesOrReq === 'object' &&
		'oncomplete' in kUsePromisesOrReq
	) {
		// @TODO Don't return promise in this case
		return promise.then(
			(result) => {
				kUsePromisesOrReq.oncomplete(null, result);
			},
			(err) => {
				kUsePromisesOrReq.oncomplete(err);
			}
		);
		return;
	}

	// Promise mode
	return promise;
}

// Implement V8 internal functions in JavaScript
function getOwnNonIndexProperties(obj, filter) {
	if (typeof obj !== 'object' || obj === null) {
		return [];
	}

	const ALL_PROPERTIES = 0;
	const ONLY_WRITABLE = 1;
	const ONLY_ENUMERABLE = 2;
	const ONLY_CONFIGURABLE = 4;
	const SKIP_STRINGS = 8;
	const SKIP_SYMBOLS = 16;

	let keys = [];

	// Get string keys
	if (!(filter & SKIP_STRINGS)) {
		keys = keys.concat(
			Object.getOwnPropertyNames(obj).filter((k) => {
				// Skip numeric indices
				const num = Number(k);
				if (Number.isInteger(num) && num >= 0 && String(num) === k) {
					return false;
				}
				return true;
			})
		);
	}

	// Get symbol keys
	if (!(filter & SKIP_SYMBOLS)) {
		keys = keys.concat(Object.getOwnPropertySymbols(obj));
	}

	// Apply property filters
	if (filter !== ALL_PROPERTIES) {
		keys = keys.filter((key) => {
			const desc = Object.getOwnPropertyDescriptor(obj, key);
			if (!desc) return false;

			if (filter & ONLY_WRITABLE && !desc.writable) return false;
			if (filter & ONLY_ENUMERABLE && !desc.enumerable) return false;
			if (filter & ONLY_CONFIGURABLE && !desc.configurable) return false;

			return true;
		});
	}

	return keys;
}

function getPromiseDetails(promise) {
	// Return undefined if it's not a Promise
	if (!(promise instanceof Promise)) {
		return undefined;
	}

	// We can't directly access promise state in JavaScript,
	// but we can use a trick with Promise.race
	const kPending = 0;
	const kFulfilled = 1;
	const kRejected = 2;

	// This is a best-effort polyfill since JavaScript doesn't expose promise internals
	// For synchronous inspection, we'd need to track promises ourselves
	// Return pending state as fallback
	return [kPending];
}

function getProxyDetails(proxy, includeTarget = true) {
	// Return undefined if it's not a proxy
	// Unfortunately, JavaScript doesn't provide a way to detect if something is a Proxy
	// or to extract its target and handler
	// This is a limitation of the language
	return undefined;
}

function previewEntries(obj) {
	// Preview entries for Maps, Sets, typed arrays etc
	if (obj instanceof Map) {
		const entries = Array.from(obj.entries()).slice(0, 100);
		return [entries, entries.length < obj.size];
	}
	if (obj instanceof Set) {
		const entries = Array.from(obj.values()).slice(0, 100);
		return [entries, entries.length < obj.size];
	}
	// For arrays and typed arrays
	if (Array.isArray(obj) || ArrayBuffer.isView(obj)) {
		const entries = Array.from(obj).slice(0, 100);
		return [entries, entries.length < obj.length];
	}
	return undefined;
}

function internalGetConstructorName(obj) {
	if (obj === null || obj === undefined) {
		return '';
	}
	if (typeof obj !== 'object' && typeof obj !== 'function') {
		return '';
	}
	// Get constructor name
	if (obj.constructor && obj.constructor.name) {
		return obj.constructor.name;
	}
	// Fallback to Object.prototype.toString
	const str = Object.prototype.toString.call(obj);
	const match = str.match(/^\[object (\w+)\]$/);
	return match ? match[1] : 'Object';
}

function getExternalValue(external) {
	// External values are V8-specific and represent C++ pointers
	// We can't truly polyfill this in JavaScript
	// Return 0n as a placeholder
	return 0n;
}

function createDebugProxy(name, target) {
	return new Proxy(target, {
		get(obj, prop) {
			const value = obj[prop];
			if (value === undefined) {
				console.log(
					`${name} binding: undefined property '${String(
						prop
					)}' accessed`
				);
			}
			return value;
		},
	});
}

// Fill a provided stats array at a specific offset
// This is used by the native binding to populate the shared statValues arrays
// offset is in fields (18 fields per Stats instance)
function fillStatsArray(arr, stats, useBigint, offset = 0) {
	// Convert to appropriate type
	const toType = useBigint ? BigInt : Number;

	// File type constants (from Node.js constants)
	const S_IFREG = 32768; // Regular file
	const S_IFDIR = 16384; // Directory
	const S_IFLNK = 40960; // Symbolic link

	// Combine file type bits with permission bits
	let mode = stats.mode;
	if (stats.type === 'file') {
		mode = S_IFREG | stats.mode;
	} else if (stats.type === 'dir') {
		mode = S_IFDIR | stats.mode;
	} else if (stats.type === 'symlink') {
		mode = S_IFLNK | stats.mode;
	}

	// Fill array in the order expected by Node.js
	// See FsStatsOffset in src/node_file.h
	arr[offset + 0] = toType(0); // dev
	arr[offset + 1] = toType(mode); // mode (with file type bits)
	arr[offset + 2] = toType(1); // nlink
	arr[offset + 3] = toType(0); // uid
	arr[offset + 4] = toType(0); // gid
	arr[offset + 5] = toType(0); // rdev
	arr[offset + 6] = toType(4096); // blksize
	arr[offset + 7] = toType(0); // ino
	arr[offset + 8] = toType(stats.size); // size
	arr[offset + 9] = toType(Math.ceil(stats.size / 512)); // blocks

	// Time values - split into seconds and nanoseconds
	arr[offset + 10] = toType(Math.floor(stats.atimeMs / 1000)); // atimeSec
	arr[offset + 11] = toType((stats.atimeMs % 1000) * 1000000); // atimeNsec
	arr[offset + 12] = toType(Math.floor(stats.mtimeMs / 1000)); // mtimeSec
	arr[offset + 13] = toType((stats.mtimeMs % 1000) * 1000000); // mtimeNsec
	arr[offset + 14] = toType(Math.floor(stats.ctimeMs / 1000)); // ctimeSec
	arr[offset + 15] = toType((stats.ctimeMs % 1000) * 1000000); // ctimeNsec
	arr[offset + 16] = toType(Math.floor(stats.birthtimeMs / 1000)); // birthtimeSec
	arr[offset + 17] = toType((stats.birthtimeMs % 1000) * 1000000); // birthtimeNsec
}
class InternalFileHandle {
	constructor(fd, fs) {
		this.fd = fd;
		this.fs = fs;
	}

	close() {
		return new Promise((resolve, reject) => {
			if (this.fd !== undefined) {
				try {
					this.fs.closeSync(this.fd);
					this.fd = undefined;
					resolve();
				} catch (error) {
					reject(error);
				}
			} else {
				resolve();
			}
		});
	}

	read(offset, length, position) {
		if (this.fd === undefined) {
			throw createFsError('EBADF', 'EBADF: bad file descriptor, read');
		}
		return this.fs.readSync(this.fd, length, position);
	}

	write(buffer, offset, length, position) {
		throw new Error('Not implemented');
		if (this.fd === undefined) {
			throw createFsError('EBADF', 'EBADF: bad file descriptor, write');
		}
		return this.fs.writeSync(this.fd, buffer, offset, length, position);
	}

	stat(bigint = false) {
		if (this.fd === undefined) {
			throw createFsError('EBADF', 'EBADF: bad file descriptor, fstat');
		}
		const openFile = this.fs.openFiles.get(this.fd);
		if (!openFile) {
			throw createFsError('EBADF', 'EBADF: bad file descriptor, fstat');
		}
		return new Stats(openFile.node);
	}

	truncate(len = 0) {
		if (this.fd === undefined) {
			throw createFsError(
				'EBADF',
				'EBADF: bad file descriptor, ftruncate'
			);
		}
		return this.fs.ftruncateSync(this.fd, len);
	}

	ftruncate(len = 0) {
		// Alias for truncate - both do the same thing
		return this.truncate(len);
	}

	utimes(atime, mtime) {
		if (this.fd === undefined) {
			throw createFsError('EBADF', 'EBADF: bad file descriptor, futimes');
		}
		return this.fs.futimesSync(this.fd, atime, mtime);
	}

	chmod(mode) {
		if (this.fd === undefined) {
			throw createFsError('EBADF', 'EBADF: bad file descriptor, fchmod');
		}
		const openFile = this.fs.openFiles.get(this.fd);
		if (!openFile) {
			throw createFsError('EBADF', 'EBADF: bad file descriptor, fchmod');
		}
		openFile.node.mode = mode;
	}

	chown(uid, gid) {
		if (this.fd === undefined) {
			throw createFsError('EBADF', 'EBADF: bad file descriptor, fchown');
		}
		// No-op in browser environment, but don't throw
	}

	datasync() {
		if (this.fd === undefined) {
			throw createFsError(
				'EBADF',
				'EBADF: bad file descriptor, fdatasync'
			);
		}
		// No-op in memory filesystem (always synced)
	}

	sync() {
		if (this.fd === undefined) {
			throw createFsError('EBADF', 'EBADF: bad file descriptor, fsync');
		}
		// No-op in memory filesystem (always synced)
	}
}
function promiseFromSync(syncFn) {
	return new Promise((resolve, reject) => {
		try {
			resolve(syncFn());
		} catch (err) {
			reject(err);
		}
	});
}
globalThis.internalModules = {
	builtins: {
		...builtins,
	},
	util: createDebugProxy('util', {
		privateSymbols: {
			module_source_private_symbol: Symbol(
				'module_source_private_symbol'
			),
			module_export_names_private_symbol: Symbol(
				'module_export_names_private_symbol'
			),
			module_circular_visited_private_symbol: Symbol(
				'module_circular_visited_private_symbol'
			),
			module_export_private_symbol: Symbol(
				'module_export_private_symbol'
			),
			module_first_parent_private_symbol: Symbol(
				'module_first_parent_private_symbol'
			),
			module_last_parent_private_symbol: Symbol(
				'module_last_parent_private_symbol'
			),
			arrow_message_private_symbol: Symbol('node:arrowMessage'),
			contextify_context_private_symbol: Symbol(
				'node:contextify:context'
			),
			decorated_private_symbol: Symbol('node:decorated'),
			transfer_mode_private_symbol: Symbol('node:transfer_mode'),
			host_defined_option_symbol: Symbol(
				'node:host_defined_option_symbol'
			),
			js_transferable_wrapper_private_symbol: Symbol(
				'node:js_transferable_wrapper'
			),
			entry_point_module_private_symbol: Symbol(
				'node:entry_point_module'
			),
			entry_point_promise_private_symbol: Symbol(
				'node:entry_point_promise'
			),
			napi_type_tag: Symbol('node:napi:type_tag'),
			napi_wrapper: Symbol('node:napi:wrapper'),
			untransferable_object_private_symbol: Symbol(
				'node:untransferableObject'
			),
			exit_info_private_symbol: Symbol('node:exit_info_private_symbol'),
			promise_trace_id: Symbol('node:promise_trace_id'),
			source_map_data_private_symbol: Symbol(
				'node:source_map_data_private_symbol'
			),
			exiting_aliased_Uint32Array: Symbol('exiting_aliased_Uint32Array'),
		},
		defineLazyProperties: (target, id, keys, writable = true) => {
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i];
				let value;
				let setterCalled = false;

				// Create a getter that will lazy-load the module
				const getter = new Function(
					'id',
					'key',
					`
					if (this.__lazyValue_${key}) {
						return this.__lazyValue_${key};
					}
					
					// Try to load from module registry
					let mod = globalThis.__moduleRegistry.get('${id}');
					
					// Fallback to other locations
					if (!mod) {
						const moduleKey = '${id}'.replace('internal/', '').replace(/\\//g, '_');
						mod = globalThis.internalModules[moduleKey] || globalThis.coreModules[moduleKey];
					}
					
					if (mod && mod['${key}']) {
						this.__lazyValue_${key} = mod['${key}'];
						return this.__lazyValue_${key};
					}
					
					return undefined;
				`
				);

				Object.defineProperty(target, key, {
					enumerable: true,
					configurable: true,
					get: getter,
					set: writable
						? function (val) {
								this[`__lazyValue_${key}`] = val;
						  }
						: undefined,
				});
			}
		},
		constants: {
			kPending: 0,
			kFulfilled: 1,
			kRejected: 2,
			kExiting: 0,
			kExitCode: 1,
			kHasExitCode: 2,
			ALL_PROPERTIES: 0,
			ONLY_WRITABLE: 1,
			ONLY_ENUMERABLE: 2,
			ONLY_CONFIGURABLE: 4,
			SKIP_STRINGS: 8,
			SKIP_SYMBOLS: 16,
			kDisallowCloneAndTransfer: 0,
			kTransferable: 1,
			kCloneable: 2,
		},
		propertyFilter: {
			ALL_PROPERTIES: 0,
			ONLY_WRITABLE: 1,
			ONLY_ENUMERABLE: 2,
			ONLY_CONFIGURABLE: 4,
			SKIP_STRINGS: 8,
			SKIP_SYMBOLS: 16,
		},
		getOwnNonIndexProperties,
		getPromiseDetails,
		getProxyDetails,
		previewEntries,
		getConstructorName: internalGetConstructorName,
		getExternalValue,
	}),
	options: {
		// CLI Flags here.
		// By default, no flags are passed.
		getCLIOptionsValues: () => {
			return new Proxy(
				{},
				{
					get: (target, prop) => {
						if (!(prop in target)) {
							target[prop] = '';
						}
						return target[prop];
					},
				}
			);
		},
		getCLIOptionsInfo: () => {
			return {
				options: [],
				aliases: [],
			};
		},
		getOptionsAsFlags: () => {
			return [];
		},
		getEmbedderOptions: () => {
			return {};
		},
		getEnvOptionsInputType: () => {
			return {};
		},
		getNamespaceOptionsInputType: () => {
			return {};
		},
	},
	config: {
		get: () => ({}),
	},
	contextify: createDebugProxy('contextify', {
		containsModuleSyntax() {
			console.warn('containsModuleSyntax called', { arguments });
			return false;
		},
		compileFunctionForCJSLoader: (
			content,
			filename,
			is_sea_main,
			shouldDetectModule
		) => {
			// Remove up to two shebang lines if present
			if (content.startsWith('#!')) {
				let shebangCount = 0;
				const lines = content.split('\n');
				while (
					lines[0].startsWith('#!') &&
					lines.length > 0 &&
					shebangCount < 2
				) {
					lines.shift();
					shebangCount++;
				}
				content = lines.join('\n');
			}

			content = globalThis.coreModules.module.Module.wrap(`
				${content}
			`);
			let fn = '';
			if (filename.endsWith('.json')) {
				fn = () => JSON.parse(content);
			} else {
				fn = eval(content);
			}
			// if (content.includes('brotliDecompressSync')) {
			// 	window.stableConsole.log('BROTLI DECOMPRESS SYNC', content);
			// }
			return {
				sourceMapURL: () => {},
				sourceURL: '',
				cachedDataRejected: false,
				function: fn,
			};
		},
		ContextifyContext: class ContextifyContext {
			constructor() {
				this.context = undefined;
			}
		},
		ContextifyScript: class ContextifyScript {
			constructor() {
				this.context = undefined;
			}
		},
	}),
	modules: createDebugProxy('modules', {
		compileCacheStatus: [],
		cachedCodeTypes: {
			kStrippedTypeScript: 2,
			kTransformedTypeScript: 3,
			kTransformedTypeScriptWithSourceMaps: 4,
		},
		readPackageJSON(jsonPath, isESM, base, specifier) {
			try {
				const parsed = JSON.parse(
					globalFs.readFileSync(jsonPath, 'utf8')
				);
				const {
					name = null,
					main = null,
					type = null,
					imports: plainImports,
				} = parsed;
				let exportsMain = parsed.main;
				if (exportsMain) {
					if (!exportsMain.startsWith('./')) {
						exportsMain = './' + exportsMain;
					}
					if (
						!exportsMain.endsWith('.js') &&
						!exportsMain.endsWith('.cjs') &&
						!exportsMain.endsWith('.mjs')
					) {
						exportsMain += '.js';
					}
				}
				return [
					name,
					main,
					type,
					plainImports ?? undefined,
					exportsMain ?? undefined,
					jsonPath,
				];
			} catch (error) {
				console.warn(
					`Failed to read package.json at ${jsonPath}:`,
					error
				);
				return undefined;
			}
		},
		getNearestParentPackageJSONType(mainPath) {
			// Start from the directory containing mainPath
			let currentDir = globalThis.coreModules.path.dirname(mainPath);

			// Traverse up the directory tree
			while (currentDir !== '/' && currentDir !== '.') {
				const packageJsonPath = globalThis.coreModules.path.join(
					currentDir,
					'package.json'
				);

				try {
					// Check if package.json exists
					if (globalFs.existsSync(packageJsonPath)) {
						const packageJson = JSON.parse(
							globalFs.readFileSync(packageJsonPath, 'utf8')
						);

						// Return the type field, defaulting to 'commonjs'
						return packageJson.type || 'commonjs';
					}
				} catch (error) {
					// If we can't read the package.json, continue searching up
					console.warn(
						`Failed to read package.json at ${packageJsonPath}:`,
						error.message
					);
				}

				// Move up one directory
				const parentDir =
					globalThis.coreModules.path.dirname(currentDir);
				if (parentDir === currentDir) {
					// We've reached the root
					break;
				}
				currentDir = parentDir;
			}

			// Default to 'commonjs' if no package.json found
			return 'commonjs';
		},
	}),
	fs: createDebugProxy(
		'fs',
		{
			kUsePromises: Symbol('kUsePromises'),
			StatWatcher: class StatWatcher {
				constructor() {
					this.persistent = false;
					console.trace('StatWatcher constructor');
				}
			},
			FileHandle: class FileHandle {
				constructor() {
					this.persistent = false;
					console.trace('FileHandle constructor');
				}
			},
			FSReqCallback: class FSReqCallback {
				constructor() {
					this.context = undefined;
					this.oncomplete = () => {};
				}

				// Called when the async operation completes
				// Node.js C++ code calls this with (err, result, ...)
				// We simulate this pattern
			},
			// Stat arrays - shared buffers for performance
			// These hold stat data and are reused across stat calls
			// Buffer is 2x the field count to hold 2 Stats instances (for StatWatcher)
			statValues: new Float64Array(18 * 2),
			bigintStatValues: new BigInt64Array(18 * 2),
			statFsValues: new Float64Array(7),
			bigintStatFsValues: new BigInt64Array(7),
			kFsStatsFieldsNumber: 18,
			constants: {},
			open(path, flags, mode, reqOrPromise) {
				return maybePromiseFromSync(
					() => globalFs.openSync(path, flags, mode),
					reqOrPromise
				);
			},
			openFileHandle(path, flags, mode, usePromises) {
				if (
					usePromises !== undefined &&
					typeof usePromises !== 'symbol'
				) {
					// @TODO: Remove this if everything is stable. I just wasn't sure if
					//        that fourth argument is ever used in a different way.
					throw new Error(
						'openFileHandle fourt argument should be undefined or symbol'
					);
				}
				if (usePromises) {
					return promiseFromSync(() =>
						this.openFileHandleSync(path, flags, mode)
					);
				}
				return this.openFileHandleSync(path, flags, mode);
			},
			openFileHandleSync(path, flags, mode) {
				const FileHandle = globalThis.coreModules['fs'].FileHandle;
				const fd = globalFs.openSync(path, flags, mode);
				const internalHandle = new InternalFileHandle(fd, globalFs);
				return new FileHandle(internalHandle);
			},
			// Used to speed up module loading.  Returns 0 if the path refers to
			// a file, 1 when it's a directory or < 0 on error (usually -ENOENT.)
			// The speedup comes from not creating thousands of Stat and Error objects.
			// Do not expose this function through public API as it doesn't hold
			// Permission Model checks.
			// @see node_file.cc
			internalModuleStat(receiver /* unknown */, path /* string */) {
				let stats;
				try {
					stats = globalFs.statSync(path ?? receiver);
				} catch (e) {
					return -1;
				}
				return stats?.isDirectory() ? 1 : stats?.isFile() ? 0 : -1;
			},
			exists(path) {
				console.log(
					'Regular exists – how is it different from existsSync?'
				);
				return globalFs.existsSync(path);
			},
			existsSync(path) {
				return globalFs.existsSync(path);
			},
			mkdir(path, options, recursive, kUsePromises) {
				// Properly merge options and recursive parameter
				let finalOptions = options;
				if (typeof options === 'number') {
					// If options is a number, it's the mode
					finalOptions = { mode: options, recursive: recursive };
				} else if (options && typeof options === 'object') {
					// If options is an object, merge in the recursive parameter
					finalOptions = { ...options, recursive: recursive };
				} else if (recursive !== undefined) {
					// If only recursive is provided
					finalOptions = { recursive: recursive };
				}

				return maybePromiseFromSync(
					() => globalFs.mkdirSync(path, finalOptions),
					kUsePromises
				);
			},
			close(fd, reqOrPromise) {
				return maybePromiseFromSync(
					() => globalFs.closeSync(fd),
					reqOrPromise
				);
			},
			read(fd, buffer, offset, length, position, reqOrPromise) {
				return maybePromiseFromSync(() => {
					// Read data from the filesystem
					const sourceBuffer = globalFs.readSync(
						fd,
						length,
						position
					);

					// Copy the data into the provided buffer at the specified offset
					const bytesToCopy = Math.min(sourceBuffer.length, length);
					if (bytesToCopy > 0) {
						buffer.set(
							sourceBuffer.subarray(0, bytesToCopy),
							offset
						);
					}

					// Return the number of bytes actually read
					return bytesToCopy;
				}, reqOrPromise);
			},
			readdir(path, encoding, withFileTypes, kUsePromises) {
				return maybePromiseFromSync(
					() =>
						globalFs.readdirBinding(path, encoding, withFileTypes),
					kUsePromises
				);
			},
			readFileUtf8(path, flags) {
				// readFileUtf8 is a synchronous optimized path for reading UTF-8 files
				// It takes a path (string, Buffer, or file descriptor) and flags (number)
				// Returns the file contents as a UTF-8 string
				const usingFileDescriptor = typeof path === 'number';
				const normalizedFlags =
					typeof flags === 'number' ? flags : undefined;

				// Fast path: delegate to the kernel's readFileSync whenever we have a string/URL
				// path and default read-only flags. The kernel already returns complete UTF-8 data.
				if (
					!usingFileDescriptor &&
					(normalizedFlags === 0 || normalizedFlags === undefined)
				) {
					return globalFs.readFileSync(path, 'utf8');
				}

				let fd = path;
				if (!usingFileDescriptor) {
					fd = globalFs.openSync(path, normalizedFlags ?? 0);
				}

				try {
					return readUtf8FromFileDescriptor(fd);
				} finally {
					if (!usingFileDescriptor && typeof fd === 'number') {
						globalFs.closeSync(fd);
					}
				}
			},
			readFile(path, options, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.readFileSync(path, options),
					kUsePromises
				);
			},
			writeFile(path, data, options, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.writeFileSync(path, data, options),
					kUsePromises
				);
			},
			rmSync(path, maxRetries, recursive, retryDelay) {
				return globalFs.rmSync(path, maxRetries, recursive, retryDelay);
			},
			cpSyncCheckPaths(src, dest, dereference, recursive) {
				return globalFs.cpSyncCheckPaths(
					src,
					dest,
					dereference,
					recursive
				);
			},
			cpSync(src, dest, options) {
				return globalFs.cpSync(src, dest, options);
			},
			cpSyncCopyDir(
				src,
				dest,
				force,
				dereference,
				errorOnExist,
				verbatimSymlinks,
				preserveTimestamps
			) {
				// This is an optimization for cpSync when no filter is provided
				// We can just call our cpSync implementation with the appropriate options
				const options = {
					force,
					dereference,
					errorOnExist,
					verbatimSymlinks,
					preserveTimestamps,
					recursive: true,
					filter: null,
				};
				return globalFs.cpSync(src, dest, options);
			},
			cpSyncOverrideFile(src, dest) {
				// This is used to override a file during copy
				// Just copy the file, overwriting if it exists
				return globalFs.copyFileSync(src, dest, 0);
			},
			symlink(target, path, type, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.symlinkSync(target, path, type),
					kUsePromises
				);
			},
			readBuffers(fd, buffers, position, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.readBuffers(fd, buffers, position),
					kUsePromises
				);
			},
			mkdtemp(prefix, encoding, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.mkdtemp(prefix, encoding),
					kUsePromises
				);
			},
			ftruncate(fd, len, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.ftruncateSync(fd, len),
					kUsePromises
				);
			},
			truncate(path, len, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.truncateSync(path, len),
					kUsePromises
				);
			},
			rename(oldPath, newPath, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.renameSync(oldPath, newPath),
					kUsePromises
				);
			},
			rm(path, kUsePromises) {
				// console.log('rm', path, kUsePromises, arguments);
				return maybePromiseFromSync(
					() => globalFs.rmSync(path),
					kUsePromises
				);
			},
			rmdir(path, kUsePromises) {
				// console.log('rmdir', path, kUsePromises, arguments);
				return maybePromiseFromSync(
					() => globalFs.rmdirSync(path),
					kUsePromises
				);
			},
			stat(path, useBigint, kUsePromises, throwIfNoEntry) {
				// Native binding populates global statValues/bigintStatValues arrays
				// throwIfNoEntry defaults to true for backwards compatibility
				return maybePromiseFromSync(() => {
					try {
						const stats = globalFs.statSync(path);
						// Populate the global stat arrays
						const targetArray = useBigint
							? globalThis.internalModules.fs.bigintStatValues
							: globalThis.internalModules.fs.statValues;
						fillStatsArray(targetArray, stats, useBigint, 0);
						return targetArray;
					} catch (err) {
						// If throwIfNoEntry is false and error is ENOENT, return undefined
						if (throwIfNoEntry === false && err.code === 'ENOENT') {
							return undefined;
						}
						throw err;
					}
				}, kUsePromises);
			},
			lstat(path, useBigint, kUsePromises, throwIfNoEntry) {
				// Native binding populates global statValues/bigintStatValues arrays
				return maybePromiseFromSync(() => {
					try {
						const stats = globalFs.lstatSync(path);
						// Populate the global stat arrays
						const targetArray = useBigint
							? globalThis.internalModules.fs.bigintStatValues
							: globalThis.internalModules.fs.statValues;
						fillStatsArray(targetArray, stats, useBigint, 0);
						return targetArray;
					} catch (err) {
						// If throwIfNoEntry is false and error is ENOENT, return undefined
						if (throwIfNoEntry === false && err.code === 'ENOENT') {
							return undefined;
						}
						throw err;
					}
				}, kUsePromises);
			},
			fstat(fd, useBigint, kUsePromises, throwIfNoEntry) {
				// Native binding populates global statValues/bigintStatValues arrays
				// throwIfNoEntry defaults to true for backwards compatibility
				return maybePromiseFromSync(() => {
					try {
						const stats = globalFs.fstatSync(fd);
						// Populate the global stat arrays
						const targetArray = useBigint
							? globalThis.internalModules.fs.bigintStatValues
							: globalThis.internalModules.fs.statValues;
						fillStatsArray(targetArray, stats, useBigint, 0);
						return targetArray;
					} catch (err) {
						// If throwIfNoEntry is false and error is EBADF, return undefined
						if (
							throwIfNoEntry === false &&
							(err.code === 'ENOENT' || err.code === 'EBADF')
						) {
							return undefined;
						}
						throw err;
					}
				}, kUsePromises);
			},
			fsSync(path) {
				return globalFs.fsSync(path);
			},
			unlink(path, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.unlinkSync(path),
					kUsePromises
				);
			},

			symlink(existingPath, newPath, type, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.symlinkSync(existingPath, newPath),
					kUsePromises
				);
			},
			writeBuffer(fd, buffer, offset, length, position, reqOrPromise) {
				return maybePromiseFromSync(() => {
					return globalFs.writeBuffer(
						fd,
						buffer,
						offset,
						length,
						position
					);
				}, reqOrPromise);
			},
			writeString(fd, string, position, encoding, reqOrPromise) {
				// Promise or sync pattern
				return maybePromiseFromSync(() => {
					return globalFs.writeSync(fd, string, position, encoding);
				}, reqOrPromise);
			},
			writeBuffers(fd, buffers, position, kUsePromises) {
				// Native binding for writing multiple buffers (writev)
				return maybePromiseFromSync(() => {
					return globalFs.writeBuffersSync(fd, buffers, position);
				}, kUsePromises);
			},
			writeFileUtf8(path, data, flags, mode, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.writeFileUtf8(path, data, flags, mode),
					kUsePromises
				);
			},
			access(path, mode, kUsePromises) {
				// Check file access permissions
				return maybePromiseFromSync(() => {
					const exists = globalFs.existsSync(path);
					if (!exists) {
						const error = new Error(
							`ENOENT: no such file or directory, access '${path}'`
						);
						error.code = 'ENOENT';
						throw error;
					}
					// In browser environment, all existing files are readable/writable
					// mode parameter is ignored for simplicity
					return undefined;
				}, kUsePromises);
			},
			copyFile(src, dest, mode, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.copyFileSync(src, dest, mode),
					kUsePromises
				);
			},
			readlink(path, encoding, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.readlinkSync(path, encoding),
					kUsePromises
				);
			},
			realpath(path, encoding, kUsePromises) {
				// Return the absolute path if file exists, otherwise throw ENOENT
				// Since we don't have symlinks, realpath just verifies the file exists
				// and returns its path
				return maybePromiseFromSync(() => {
					// Check if file exists
					if (!globalFs.existsSync(path)) {
						const error = new Error(
							`ENOENT: no such file or directory, realpath '${path}'`
						);
						error.code = 'ENOENT';
						throw error;
					}
					// Return the path as-is since we don't have symlinks to resolve
					// In a real filesystem, this would resolve symlinks and return canonical path
					return path;
				}, kUsePromises);
			},
			utimes(path, atime, mtime, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.utimesSync(path, atime, mtime),
					kUsePromises
				);
			},
			futimes(fd, atime, mtime, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.futimesSync(fd, atime, mtime),
					kUsePromises
				);
			},
			lutimes(path, atime, mtime, kUsePromises) {
				return maybePromiseFromSync(() => {
					// Update timestamps on symlink itself if symlink; otherwise behave like utimes
					const { node } = globalFs.walk(path);
					if (!node) {
						const error = new Error(
							`ENOENT: no such file or directory, lutimes '${path}'`
						);
						error.code = 'ENOENT';
						throw error;
					}
					if (node.type !== 'symlink') {
						// If not a symlink, match Node: apply to target file
						return globalFs.utimesSync(path, atime, mtime);
					}
					// For symlink, store times on the link node
					// Node.js binding receives UNIX timestamps in seconds, we store in milliseconds
					node.atime =
						typeof atime === 'number'
							? atime * 1000
							: atime.getTime();
					node.mtime =
						typeof mtime === 'number'
							? mtime * 1000
							: mtime.getTime();
					node.ctime = Date.now();
				}, kUsePromises);
			},
			ftruncate(fd, len, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.ftruncateSync(fd, len),
					kUsePromises
				);
			},
			chmod(path, mode, kUsePromises) {
				// File permissions are simplified in browser environment
				return maybePromiseFromSync(() => undefined, kUsePromises);
			},
			fchmod(fd, mode, kUsePromises) {
				// File permissions are simplified in browser environment
				return maybePromiseFromSync(() => undefined, kUsePromises);
			},
			chown(path, uid, gid, kUsePromises) {
				// File ownership is not supported in browser environment
				return maybePromiseFromSync(() => undefined, kUsePromises);
			},
			fchown(fd, uid, gid, kUsePromises) {
				// File ownership is not supported in browser environment
				return maybePromiseFromSync(() => undefined, kUsePromises);
			},
			fsync(fd, kUsePromises) {
				// Always synced in memory filesystem
				return maybePromiseFromSync(() => undefined, kUsePromises);
			},
			fdatasync(fd, kUsePromises) {
				// Always synced in memory filesystem
				return maybePromiseFromSync(() => undefined, kUsePromises);
			},
			link(existingPath, newPath, kUsePromises) {
				return maybePromiseFromSync(
					() => globalFs.linkSync(existingPath, newPath),
					kUsePromises
				);
			},
		},
		'fs'
	),
	mksnapshot: {
		setSerializeCallback() {},
		setDeserializeCallback() {},
		setDeserializeMainFunction() {},
		isBuildingSnapshotBuffer: [],
	},
	'internal/errors': {
		exitCodes: {},
		fatalExceptionStackEnhancers: {
			beforeInspector: () => {},
			afterInspector: () => {},
		},
	},
	errors: createDebugProxy(
		'errors',
		{
			exitCodes: {},
			codes: {
				kGenericUserError: 1,
			},
			noSideEffectsToString() {},
			triggerUncaughtException() {},
			getErrorSourcePositions(error) {
				// Minimal polyfill: provide defaults to satisfy error_source.js
				return {
					sourceLine: '',
					scriptResourceName: 'eval',
					lineNumber: 1,
					startColumn: 0,
				};
			},
		},
		'errors'
	),
	string_decoder: createDebugProxy('string_decoder', {
		kIncompleteCharactersStart: 0,
		kIncompleteCharactersEnd: 4,
		kMissingBytes: 4,
		kBufferedBytes: 5,
		kEncodingField: 6,
		kNumFields: 7,
		encodings: ['utf-8', 'ascii', 'base64', 'hex'],
		kIncompleteCharactersStart: 0,
		kIncompleteCharactersEnd: 4,
		kMissingBytes: 4,
		kBufferedBytes: 5,
		kEncodingField: 6,
		kNumFields: 7,
		kSize: 2048,
		decode: (encodingBuffer, buffer, options) => {
			// encodingBuffer is a UInt8Array with 1 at the index of the encoding
			const encodingIndex =
				encodingBuffer[
					globalThis.internalModules.string_decoder.kEncodingField
				];
			const encoding =
				globalThis.internalModules.string_decoder.encodings[
					encodingIndex
				] ?? 'utf-8';
			return buffer.toString(encoding, options);
		},
		flush: (buffer) => {
			return buffer.toString();
		},
	}),
	// buffer: createDebugProxy('buffer', {
	buffer: {
		compare: (buf1, buf2) => {
			// Validate inputs are Uint8Array or Buffer
			if (
				!(buf1 instanceof Uint8Array) ||
				!(buf2 instanceof Uint8Array)
			) {
				throw new TypeError('Arguments must be Buffer or Uint8Array');
			}

			const len = Math.min(buf1.length, buf2.length);

			// Byte-by-byte comparison
			for (let i = 0; i < len; i++) {
				if (buf1[i] !== buf2[i]) {
					return buf1[i] < buf2[i] ? -1 : 1;
				}
			}

			// If all compared bytes are equal, compare lengths
			// Normalize to -1, 0, or 1 as per Node.js behavior
			if (buf1.length === buf2.length) {
				return 0;
			}
			return buf1.length < buf2.length ? -1 : 1;
		},
	},
	types: createDebugProxy('types', {
		isRegExp(value) {
			return Object.prototype.toString.call(value) === '[object RegExp]';
		},
		isDate(value) {
			return Object.prototype.toString.call(value) === '[object Date]';
		},
		isNativeError(value) {
			if (value === null || value === undefined) {
				return false;
			}
			// Check if it's an instance of Error or one of the native error types
			return (
				value instanceof Error ||
				value instanceof EvalError ||
				value instanceof RangeError ||
				value instanceof ReferenceError ||
				value instanceof SyntaxError ||
				value instanceof TypeError ||
				value instanceof URIError ||
				(typeof AggregateError !== 'undefined' &&
					value instanceof AggregateError)
			);
		},
		isPromise(value) {
			return value instanceof Promise;
		},
		isProxy(value) {
			// JavaScript doesn't provide a way to detect proxies reliably
			// This is a limitation of the language
			return false;
		},
		isMap(value) {
			return Object.prototype.toString.call(value) === '[object Map]';
		},
		isSet(value) {
			return Object.prototype.toString.call(value) === '[object Set]';
		},
		isMapIterator(value) {
			return (
				Object.prototype.toString.call(value) ===
				'[object Map Iterator]'
			);
		},
		isSetIterator(value) {
			return (
				Object.prototype.toString.call(value) ===
				'[object Set Iterator]'
			);
		},
		isWeakMap(value) {
			return Object.prototype.toString.call(value) === '[object WeakMap]';
		},
		isWeakSet(value) {
			return Object.prototype.toString.call(value) === '[object WeakSet]';
		},
		isArrayBuffer(value) {
			return (
				Object.prototype.toString.call(value) === '[object ArrayBuffer]'
			);
		},
		isDataView(value) {
			return (
				Object.prototype.toString.call(value) === '[object DataView]'
			);
		},
		isSharedArrayBuffer(value) {
			return (
				Object.prototype.toString.call(value) ===
				'[object SharedArrayBuffer]'
			);
		},
		isTypedArray(value) {
			return ArrayBuffer.isView(value) && !(value instanceof DataView);
		},
		isUint8Array(value) {
			return (
				Object.prototype.toString.call(value) === '[object Uint8Array]'
			);
		},
		isUint8ClampedArray(value) {
			return (
				Object.prototype.toString.call(value) ===
				'[object Uint8ClampedArray]'
			);
		},
		isUint16Array(value) {
			return (
				Object.prototype.toString.call(value) === '[object Uint16Array]'
			);
		},
		isUint32Array(value) {
			return (
				Object.prototype.toString.call(value) === '[object Uint32Array]'
			);
		},
		isInt8Array(value) {
			return (
				Object.prototype.toString.call(value) === '[object Int8Array]'
			);
		},
		isInt16Array(value) {
			return (
				Object.prototype.toString.call(value) === '[object Int16Array]'
			);
		},
		isInt32Array(value) {
			return (
				Object.prototype.toString.call(value) === '[object Int32Array]'
			);
		},
		isFloat32Array(value) {
			return (
				Object.prototype.toString.call(value) ===
				'[object Float32Array]'
			);
		},
		isFloat64Array(value) {
			return (
				Object.prototype.toString.call(value) ===
				'[object Float64Array]'
			);
		},
		isBigInt64Array(value) {
			return (
				Object.prototype.toString.call(value) ===
				'[object BigInt64Array]'
			);
		},
		isBigUint64Array(value) {
			return (
				Object.prototype.toString.call(value) ===
				'[object BigUint64Array]'
			);
		},
		isGeneratorObject(value) {
			return (
				Object.prototype.toString.call(value) === '[object Generator]'
			);
		},
		isGeneratorFunction(value) {
			return (
				Object.prototype.toString.call(value) ===
				'[object GeneratorFunction]'
			);
		},
		isAsyncFunction(value) {
			return (
				Object.prototype.toString.call(value) ===
				'[object AsyncFunction]'
			);
		},
		isArrayBufferView(value) {
			return ArrayBuffer.isView(value);
		},
		isBoxedPrimitive(value) {
			return (
				value instanceof Boolean ||
				value instanceof Number ||
				value instanceof String ||
				value instanceof Symbol ||
				value instanceof BigInt
			);
		},
		isAnyArrayBuffer(value) {
			const tag = Object.prototype.toString.call(value);
			return (
				tag === '[object ArrayBuffer]' ||
				tag === '[object SharedArrayBuffer]'
			);
		},
		isArgumentsObject(value) {
			return (
				Object.prototype.toString.call(value) === '[object Arguments]'
			);
		},
		isBooleanObject(value) {
			return Object.prototype.toString.call(value) === '[object Boolean]';
		},
		isNumberObject(value) {
			return Object.prototype.toString.call(value) === '[object Number]';
		},
		isStringObject(value) {
			return Object.prototype.toString.call(value) === '[object String]';
		},
		isSymbolObject(value) {
			return Object.prototype.toString.call(value) === '[object Symbol]';
		},
		isBigIntObject(value) {
			return Object.prototype.toString.call(value) === '[object BigInt]';
		},
		isModuleNamespaceObject(value) {
			return Object.prototype.toString.call(value) === '[object Module]';
		},
	}),
	timers: createDebugProxy('timers', {
		timeoutInfo: [],
		immediateInfo: [],
	}),
	trace_events: {
		getCategoryEnabledBuffer() {
			return [9];
		},
		trace() {
			// Do nothing
		},
	},
	credentials: {
		// ENV Variables
		safeGetenv(key) {
			return '';
		},
	},
	performance: {
		constants: {},
		setupObservers() {},
	},
	js_stream: createDebugProxy('js_stream', {
		JSStream: class JSStream {
			constructor() {
				this.persistent = false;
			}
		},
	}),
	blob: createDebugProxy('blob', {
		createBlob() {
			throw new Error('Not implemented');
		},
		createBlobFromFilePath() {
			throw new Error('Not implemented');
		},
		concat() {
			throw new Error('Not implemented');
		},
		getDataObject() {
			throw new Error('Not implemented');
		},
	}),
	encoding_binding: createDebugProxy('encoding_binding', {
		encodeIntoResults() {
			throw new Error('Not implemented');
		},
		encodeInto() {
			throw new Error('Not implemented');
		},
		encodeUtf8String() {
			throw new Error('Not implemented');
		},
		decodeUTF8() {
			throw new Error('Not implemented');
		},
		decodeLatin1() {
			throw new Error('Not implemented');
		},
		toASCII() {
			throw new Error('Not implemented');
		},
		toUnicode() {
			throw new Error('Not implemented');
		},
	}),
	process_methods: createDebugProxy('process_methods', {
		hrtimeBuffer: {},
	}),
	url_pattern: createDebugProxy('url_pattern', {
		URLPattern: class URLPattern {
			constructor(pattern) {
				this.pattern = pattern;
			}
			test(input) {
				throw new Error('URLPattern.test not implemented');
			}
			exec(input) {
				throw new Error('URLPattern.exec not implemented');
			}
		},
	}),
	url: createDebugProxy('url', {
		pathToFileURL(filepath) {
			if (typeof filepath !== 'string') {
				throw new TypeError('Path must be a string');
			}

			// Handle trailing slashes - add back trailing slash if original had one
			let resolved = filepath;
			const hadTrailingSlash = filepath.endsWith('/');

			// Encode the path for file URL
			const encodedPath = this._encodePathForFileURL(resolved);

			// Create and return the URL
			return new URL(`file://${encodedPath}`);
		},

		fileURLToPath(input, options) {
			const errorCodes = globalThis.internalModules?.errors?.codes ?? {};
			const {
				ERR_INVALID_ARG_TYPE,
				ERR_INVALID_URL_SCHEME,
				ERR_INVALID_FILE_URL_HOST,
				ERR_INVALID_FILE_URL_PATH,
			} = errorCodes;

			const throwInvalidArgType = (value) => {
				if (typeof ERR_INVALID_ARG_TYPE === 'function') {
					throw new ERR_INVALID_ARG_TYPE(
						'path',
						['string', 'URL'],
						value
					);
				}
				const err = new TypeError(
					'The "path" argument must be of type string or an instance of URL.'
				);
				err.code = 'ERR_INVALID_ARG_TYPE';
				throw err;
			};

			const throwInvalidScheme = () => {
				if (typeof ERR_INVALID_URL_SCHEME === 'function') {
					throw new ERR_INVALID_URL_SCHEME('file');
				}
				const err = new TypeError('The URL must be of scheme file:');
				err.code = 'ERR_INVALID_URL_SCHEME';
				throw err;
			};

			const throwInvalidHost = (platform) => {
				if (typeof ERR_INVALID_FILE_URL_HOST === 'function') {
					throw new ERR_INVALID_FILE_URL_HOST(platform);
				}
				const err = new TypeError(
					'File URL host must be empty on POSIX.'
				);
				err.code = 'ERR_INVALID_FILE_URL_HOST';
				throw err;
			};

			const throwInvalidPath = (reason, urlObj) => {
				if (typeof ERR_INVALID_FILE_URL_PATH === 'function') {
					throw new ERR_INVALID_FILE_URL_PATH(reason, urlObj);
				}
				const err = new TypeError(`Invalid file URL path: ${reason}`);
				err.code = 'ERR_INVALID_FILE_URL_PATH';
				throw err;
			};

			let urlObj;
			if (typeof input === 'string') {
				urlObj = new URL(input);
			} else if (input instanceof URL) {
				urlObj = input;
			} else {
				throwInvalidArgType(input);
			}

			if (urlObj.protocol !== 'file:') {
				throwInvalidScheme();
			}

			const windowsOption = options?.windows;
			const isWindows =
				windowsOption !== undefined
					? windowsOption
					: globalThis.process?.platform === 'win32';

			const decodeHostname = (hostname) => {
				const domainToUnicode =
					globalThis.coreModules?.url?.domainToUnicode ??
					globalThis.internalModules?.url?.domainToUnicode;
				if (typeof domainToUnicode === 'function') {
					try {
						return domainToUnicode(hostname);
					} catch {
						// Fall back to the raw hostname if conversion fails.
					}
				}
				return hostname;
			};

			const ensureNoEncodedSeparators = (pathname, sequences) => {
				for (let i = 0; i < pathname.length; i++) {
					if (pathname[i] !== '%' || i + 2 >= pathname.length)
						continue;
					const second = pathname[i + 1];
					const third = pathname[i + 2].toLowerCase();
					for (const seq of sequences) {
						if (second === seq[0] && third === seq[1]) {
							return false;
						}
					}
				}
				return true;
			};

			if (isWindows) {
				const winPathFromURL = (urlInstance) => {
					let pathname = urlInstance.pathname;
					if (
						!ensureNoEncodedSeparators(pathname, [
							['2', 'f'],
							['5', 'c'],
						])
					) {
						throwInvalidPath(
							'must not include encoded \\ or / characters',
							urlInstance
						);
					}
					pathname = pathname.replace(/\//g, '\\');
					pathname = decodeURIComponent(pathname);
					if (urlInstance.hostname) {
						const host = decodeHostname(urlInstance.hostname);
						return `\\\\${host}${pathname}`;
					}
					const letter = pathname.charCodeAt(1);
					const sep = pathname[2];
					if (
						!letter ||
						(letter | 0x20) < 97 ||
						(letter | 0x20) > 122 ||
						sep !== ':'
					) {
						throwInvalidPath('must be absolute', urlInstance);
					}
					return pathname.slice(1);
				};

				return winPathFromURL(urlObj);
			}

			const posixPathFromURL = (urlInstance) => {
				if (urlInstance.hostname) {
					const platform = globalThis.process?.platform ?? 'posix';
					throwInvalidHost(platform);
				}
				const { pathname } = urlInstance;
				if (!ensureNoEncodedSeparators(pathname, [['2', 'f']])) {
					throwInvalidPath(
						'must not include encoded / characters',
						urlInstance
					);
				}
				return decodeURIComponent(pathname);
			};

			return posixPathFromURL(urlObj);
		},

		_encodePathForFileURL(path) {
			// Encode the path for use in a file:// URL
			let encoded = '';

			for (let i = 0; i < path.length; i++) {
				const char = path[i];
				const code = path.charCodeAt(i);

				// Percent-encode characters that are not safe in file URLs
				if (
					char === '%' ||
					char === '#' ||
					char === '?' ||
					char === '\n' ||
					char === '\r' ||
					char === '\t'
				) {
					encoded += encodeURIComponent(char);
				} else if (code < 32 || code > 126) {
					// Control characters and non-ASCII characters
					encoded += encodeURIComponent(char);
				} else {
					encoded += char;
				}
			}

			return encoded;
		},
	}),
	permission: createDebugProxy('permission', {}),
	fs_dir: createDebugProxy(
		'fs_dir',
		(function () {
			// Implement Dir class with async iterator support
			class Dir {
				constructor(handle, path, options) {
					this.handle = handle;
					this.path = path;
					this.options = options || { encoding: 'utf8' };
					this.closed = false;
				}

				read(encodingOrCallback, bufferSize, kUsePromises) {
					// Full binding signature with kUsePromises or FSReqCallback
					console.trace('read', {
						encodingOrCallback,
						bufferSize,
						kUsePromises,
					});
					return maybePromiseFromSync(
						() => this.readSync(encodingOrCallback, bufferSize),
						kUsePromises
					);
				}

				readSync(
					encodingOrCallback = this.options.encoding,
					bufferSize = 32
				) {
					if (this.closed) {
						const err = new Error('Dir is closed');
						err.code = 'ERR_DIR_CLOSED';
						throw err;
					}
					const entry = this.handle.read(
						encodingOrCallback,
						bufferSize
					);
					if (entry === null) {
						return null;
					}
					// entry is { name, type } from the handle
					const { name, type } = entry;
					// Return a Dirent-like object
					return {
						name,
						isFile: () => type === 'file',
						isDirectory: () => type === 'dir',
						isBlockDevice: () => false,
						isCharacterDevice: () => false,
						isSymbolicLink: () => type === 'symlink',
						isFIFO: () => false,
						isSocket: () => false,
					};
				}

				close(kUsePromises) {
					return maybePromiseFromSync(
						() => this.closeSync(),
						kUsePromises
					);
				}

				closeSync() {
					if (this.closed) {
						const err = new Error('Dir is already closed');
						err.code = 'ERR_DIR_CLOSED';
						throw err;
					}
					this.handle.close();
					this.closed = true;
				}

				// Async iterator support
				async *entries() {
					try {
						while (true) {
							const entry = await this.read();
							if (entry == null) {
								break;
							}
							yield entry;
						}
					} finally {
						await this.close();
					}
				}

				// Make this async iterable
				[Symbol.asyncIterator]() {
					return this.entries();
				}
			}

			return {
				Dir,
				opendirSync(path, options) {
					const handle = globalFs.opendirSync(path);
					return new Dir(handle, path, options);
				},
				opendir(path, encoding, kUsePromises) {
					return maybePromiseFromSync(() => {
						const handle = globalFs.opendirSync(path);
						return new Dir(handle, path, { encoding });
					}, kUsePromises);
				},
			};
		})(),
		'fs_dir'
	),
	cares_wrap: {
		ChannelWrap: class ChannelWrap {
			constructor() {
				this.persistent = false;
			}
		},
	},
	stream_wrap: createDebugProxy('stream_wrap', {
		StreamWrap: class StreamWrap {
			constructor() {
				this.persistent = false;
			}
		},
		ShutdownWrap: class ShutdownWrap {
			constructor() {
				this.persistent = false;
			}
		},
		WriteWrap: class WriteWrap {
			constructor() {
				this.persistent = false;
			}
		},
		kReadBytesOrError: 0,
		kArrayBufferOffset: 1,
		kBytesWritten: 2,
		kLastWriteWasAsync: 3,
		streamBaseState: new Int32Array(4),
	}),
	pipe_wrap: createDebugProxy('pipe_wrap', {
		Pipe: class Pipe {
			constructor() {
				this.persistent = false;
			}
		},
		PipeConnectWrap: class PipeConnectWrap {
			constructor() {
				this.persistent = false;
			}
		},
		constants: {
			SOCKET: 0,
			SERVER: 1,
			IPC: 2,
		},
	}),
	worker: createDebugProxy('worker', {
		ownsProcessState: false,
		isMainThread: false,
		isInternalThread: false,
		resourceLimits: {},
		threadId: 0,
		threadName: 'WorkerThread',
		// filled in later in this file once we have
		// access to the EventEmitter constructor
		// Worker: ,
		kMaxYoungGenerationSizeMb: 1024,
		kMaxOldGenerationSizeMb: 1024,
		kCodeRangeSizeMb: 1024,
		kStackSizeMb: 1024,
		kTotalResourceLimitCount: 1024,
		getEnvMessagePort() {
			throw new Error('Not implemented');
		},
	}),
	locks: createDebugProxy('locks', {}),
	worker_threads: createDebugProxy('worker_threads', {}),
	tls_wrap: createDebugProxy('tls_wrap', {
		TLSWrap: class TLSWrap {
			constructor() {
				this.persistent = false;
			}
		},
	}),
	http_parser: createDebugProxy('http_parser', {
		HTTPParser: class HTTPParser {
			constructor() {
				this.persistent = false;
			}
		},
		ConnectionsList: class ConnectionsList {
			constructor() {
				this.connections = [];
			}
		},
		methods: [],
		allMethods: [],
	}),
	tcp_wrap: createDebugProxy('tcp_wrap', {
		TCP: class TCP {
			constructor() {
				this.persistent = false;
			}
		},
		TCPConnectWrap: class TCPConnectWrap {
			constructor() {
				this.persistent = false;
			}
		},
		constants: {
			SOCKET: 0,
			SERVER: 1,
			UV_TCP_IPV6ONLY: 1,
		},
	}),
	udp_wrap: {
		constants: {
			// @TODO: verify these
			UV_UDP_IPV6ONLY: 1,
			UV_UDP_REUSEPORT: 2,
		},
		UDP: class UDP {
			constructor() {
				this.persistent = false;
			}
		},
	},
	tty_wrap: {
		isTTY() {
			return false;
		},
		Tty: class Tty {
			constructor() {
				this.persistent = false;
			}
		},
	},
	fs_event_wrap: {
		FSEvent: class FSEvent {
			constructor() {
				this.persistent = false;
			}
		},
	},
	uv: {},
	os: createDebugProxy('os', {
		EOL: '\n',
		__esModule: true,
		devNull: '/dev/null',
		endianness: 'LE',
		freemem: () => 8589934592,
		getPriority: () => 0,
		getHomeDirectory: () => '/home/user',
		getHostname: () => 'localhost',
		availableParallelism: () => 1,
		getCPUs() {
			return [
				{
					model: 'Virtual CPU',
					speed: 2400,
					times: {
						user: 252020,
					},
				},
			];
		},
		arch() {
			return 'x64';
		},
		cpus() {
			return [
				{
					model: 'Virtual CPU',
					speed: 2400,
					times: {
						user: 252020,
						nice: 0,
						sys: 30340,
						idle: 1070356870,
						irq: 0,
					},
				},
			];
		},
		hostname() {
			return 'localhost';
		},
		machine() {
			return 'x86_64';
		},
		networkInterfaces() {
			return {
				lo: [
					{
						address: '127.0.0.1',
						netmask: '255.0.0.0',
						family: 'IPv4',
						mac: '00:00:00:00:00:00',
						internal: true,
						cidr: '127.0.0.1/8',
					},
				],
			};
		},
		platform() {
			return 'linux';
		},
		release() {
			return '5.4.0';
		},
		setPriority(pidOrPriority, priority) {
			// No-op in browser environment
		},
		tmpdir() {
			return '/tmp';
		},
		totalmem() {
			return 8589934592; // 8GB
		},
		type() {
			return 'Linux';
		},
		uptime() {
			return Math.floor(performance.now() / 1000);
		},
		version() {
			return '#1 SMP Thu Oct 6 16:21:56 UTC 2022';
		},
		getOSInformation() {
			return ['Linux', '5.4.0', '5.4.0'];
		},
		isBigEndian() {
			return false;
		},
		getAvailableParallelism() {
			return navigator.hardwareConcurrency || 10;
		},
		getFreeMem() {
			// Estimate 2GB free memory (browser environments don't expose this)
			return 2147483648;
		},
		getHostname() {
			return 'localhost';
		},
		getOSVersion() {
			return '#1 SMP Thu Oct 6 16:21:56 UTC 2022';
		},
		getOSType() {
			return 'Linux';
		},
		getOSRelease() {
			return '5.4.0';
		},
		getMachine() {
			return 'x86_64';
		},
		getHomeDirectory() {
			return '/home/user';
		},
		getTotalMem() {
			return 8589934592; // 8GB
		},
		getUptime() {
			return Math.floor(performance.now() / 1000);
		},
		homedir() {
			return '/home/user';
		},
		getPriority(pid) {
			return 0;
		},
		getInterfaceAddresses() {
			return [];
		},
		getLoadAvg() {
			return [0, 0, 0];
		},
		getOSVersion() {
			return '5.4.0';
		},
		getOSType() {
			return 'Linux';
		},
		getOSRelease() {
			return '5.4.0';
		},
		getMachine() {
			return 'x86_64';
		},
		getHomeDirectory() {
			return '/home/user';
		},
		getTotalMem() {
			return 8589934592; // 8GB
		},
		getUptime() {
			return Math.floor(performance.now() / 1000);
		},
		getUserInfo(options) {
			return {
				uid: 1000,
				gid: 1000,
				username: 'user',
				homedir: '/home/user',
				shell: '/bin/bash',
			};
		},
		setPriority(pidOrPriority, priority) {
			// No-op in browser environment
		},
	}),
	zlib: createDebugProxy('zlib', {
		Zlib: class Zlib {
			constructor() {
				this.persistent = false;
			}
		},
		crc32() {
			console.trace('zlib crc32');
			return 0;
		},
	}),
	messaging: {},
	async_wrap: {
		constants: {},
	},
	async_context_frame: {},
	task_queue: {
		promiseRejectEvents: {},
	},
	stream_pipe: new Proxy(
		{
			StreamPipe: class StreamPipe {
				constructor() {
					this.persistent = false;
				}
			},
		},
		{
			get(target, prop) {
				console.log('stream get', prop);
				return target[prop];
			},
		}
	),
	symbols: {
		fs_use_promises: Symbol('fs_use_promises_symbol'),
		async_id: Symbol('async_id_symbol'),
		constructor_key: Symbol('constructor_key_symbol'),
		handle_onclose: Symbol('handle_onclose'),
		no_message: Symbol('no_message_symbol'),
		messaging_deserialize: Symbol('messaging_deserialize_symbol'),
		imported_cjs: Symbol('imported_cjs_symbol'),
		messaging_transfer: Symbol('messaging_transfer_symbol'),
		messaging_clone: Symbol('messaging_clone_symbol'),
		messaging_transfer_list: Symbol('messaging_transfer_list_symbol'),
		oninit: Symbol('oninit'),
		owner: Symbol('owner_symbol'),
		onpskexchange: Symbol('onpskexchange'),
		resource: Symbol('resource_symbol'),
		trigger_async_id: Symbol('trigger_async_id_symbol'),
		source_text_module_default_hdo: Symbol(
			'source_text_module_default_hdo'
		),
		vm_context_no_contextify: Symbol('vm_context_no_contextify'),
		vm_dynamic_import_default_internal: Symbol(
			'vm_dynamic_import_default_internal'
		),
		vm_dynamic_import_main_context_default: Symbol(
			'vm_dynamic_import_main_context_default'
		),
		vm_dynamic_import_missing_flag: Symbol(
			'vm_dynamic_import_missing_flag'
		),
		vm_dynamic_import_no_callback: Symbol('vm_dynamic_import_no_callback'),
	},
	// http2: createDebugProxy('http2', {
	http2: {
		setCallbackFunctions() {},
		constants: {
			HTTP2_HEADER_STATUS: ':status',
			HTTP2_HEADER_METHOD: ':method',
			HTTP2_HEADER_AUTHORITY: ':authority',
			HTTP2_HEADER_SCHEME: ':scheme',
			HTTP2_HEADER_PATH: ':path',
			HTTP2_HEADER_PROTOCOL: ':protocol',
			HTTP2_HEADER_DATE: 'date',
			HTTP2_HEADER_ACCEPT_CHARSET: 'accept-charset',
			HTTP2_HEADER_ACCEPT_ENCODING: 'accept-encoding',
			HTTP2_HEADER_ACCEPT_LANGUAGE: 'accept-language',
			HTTP2_HEADER_ACCEPT_RANGES: 'accept-ranges',
			HTTP2_HEADER_ACCEPT: 'accept',
			HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS:
				'access-control-allow-credentials',
			HTTP2_HEADER_ACCESS_CONTROL_ALLOW_HEADERS:
				'access-control-allow-headers',
			HTTP2_HEADER_ACCESS_CONTROL_ALLOW_METHODS:
				'access-control-allow-methods',
			HTTP2_HEADER_ACCESS_CONTROL_ALLOW_ORIGIN:
				'access-control-allow-origin',
			HTTP2_HEADER_ACCESS_CONTROL_EXPOSE_HEADERS:
				'access-control-expose-headers',
			HTTP2_HEADER_ACCESS_CONTROL_MAX_AGE: 'access-control-max-age',
			HTTP2_HEADER_ACCESS_CONTROL_REQUEST_HEADERS:
				'access-control-request-headers',
			HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD:
				'access-control-request-method',
			HTTP2_HEADER_AGE: 'age',
			HTTP2_HEADER_ALLOW: 'allow',
			HTTP2_HEADER_AUTHORIZATION: 'authorization',
			HTTP2_HEADER_CACHE_CONTROL: 'cache-control',
			HTTP2_HEADER_CONTENT_DISPOSITION: 'content-disposition',
			HTTP2_HEADER_CONTENT_ENCODING: 'content-encoding',
			HTTP2_HEADER_CONTENT_LANGUAGE: 'content-language',
			HTTP2_HEADER_CONTENT_LENGTH: 'content-length',
			HTTP2_HEADER_CONTENT_LOCATION: 'content-location',
			HTTP2_HEADER_CONTENT_RANGE: 'content-range',
			HTTP2_HEADER_CONTENT_TYPE: 'content-type',
			HTTP2_HEADER_COOKIE: 'cookie',
			HTTP2_HEADER_CONNECTION: 'connection',
			HTTP2_HEADER_DNT: 'dnt',
			HTTP2_HEADER_ETAG: 'etag',
			HTTP2_HEADER_EXPECT: 'expect',
			HTTP2_HEADER_EXPIRES: 'expires',
			HTTP2_HEADER_FORWARDED: 'forwarded',
			HTTP2_HEADER_FROM: 'from',
			HTTP2_HEADER_HOST: 'host',
			HTTP2_HEADER_IF_MATCH: 'if-match',
			HTTP2_HEADER_IF_MODIFIED_SINCE: 'if-modified-since',
			HTTP2_HEADER_IF_NONE_MATCH: 'if-none-match',
			HTTP2_HEADER_IF_RANGE: 'if-range',
			HTTP2_HEADER_IF_UNMODIFIED_SINCE: 'if-unmodified-since',
			HTTP2_HEADER_LAST_MODIFIED: 'last-modified',
			HTTP2_HEADER_LINK: 'link',
			HTTP2_HEADER_LOCATION: 'location',
			HTTP2_HEADER_MAX_FORWARDS: 'max-forwards',
			HTTP2_HEADER_PREFER: 'prefer',
			HTTP2_HEADER_PROXY_AUTHENTICATE: 'proxy-authenticate',
			HTTP2_HEADER_PROXY_AUTHORIZATION: 'proxy-authorization',
			HTTP2_HEADER_PROXY_CONNECTION: 'proxy-connection',
			HTTP2_HEADER_RANGE: 'range',
			HTTP2_HEADER_REFERER: 'referer',
			HTTP2_HEADER_REFRESH: 'refresh',
			HTTP2_HEADER_RETRY_AFTER: 'retry-after',
			HTTP2_HEADER_SERVER: 'server',
			HTTP2_HEADER_SET_COOKIE: 'set-cookie',
			HTTP2_HEADER_STRICT_TRANSPORT_SECURITY: 'strict-transport-security',
			HTTP2_HEADER_TRAILER: 'trailer',
			HTTP2_HEADER_TRANSFER_ENCODING: 'transfer-encoding',
			HTTP2_HEADER_TK: 'tk',
			HTTP2_HEADER_UPGRADE_INSECURE_REQUESTS: 'upgrade-insecure-requests',
			HTTP2_HEADER_USER_AGENT: 'user-agent',
			HTTP2_HEADER_VARY: 'vary',
			HTTP2_HEADER_VIA: 'via',
			HTTP2_HEADER_WARNING: 'warning',
			HTTP2_HEADER_WWW_AUTHENTICATE: 'www-authenticate',
			HTTP2_HEADER_X_CONTENT_TYPE_OPTIONS: 'x-content-type-options',
			HTTP2_HEADER_X_FRAME_OPTIONS: 'x-frame-options',
			HTTP2_HEADER_KEEP_ALIVE: 'keep-alive',
			HTTP2_HEADER_CONTENT_MD5: 'content-md5',
			HTTP2_HEADER_TE: 'te',
			HTTP2_HEADER_UPGRADE: 'upgrade',
			HTTP2_HEADER_HTTP2_SETTINGS: 'http2-settings',
			HTTP2_HEADER_X_XSS_PROTECTION: 'x-xss-protection',
			HTTP2_HEADER_ALT_SVC: 'alt-svc',
			HTTP2_HEADER_CONTENT_SECURITY_POLICY: 'content-security-policy',
			HTTP2_HEADER_EARLY_DATA: 'early-data',
			HTTP2_HEADER_EXPECT_CT: 'expect-ct',
			HTTP2_HEADER_ORIGIN: 'origin',
			HTTP2_HEADER_PURPOSE: 'purpose',
			HTTP2_HEADER_TIMING_ALLOW_ORIGIN: 'timing-allow-origin',
			HTTP2_HEADER_X_FORWARDED_FOR: 'x-forwarded-for',
			HTTP2_HEADER_PRIORITY: 'priority',
		},
	},
	constants: {
		os: {
			UV_UDP_REUSEADDR: 4,
			dlopen: {
				RTLD_LAZY: 1,
				RTLD_NOW: 2,
				RTLD_GLOBAL: 8,
				RTLD_LOCAL: 4,
			},
			errno: {
				E2BIG: 7,
				EACCES: 13,
				EADDRINUSE: 48,
				EADDRNOTAVAIL: 49,
				EAFNOSUPPORT: 47,
				EAGAIN: 35,
				EALREADY: 37,
				EBADF: 9,
				EBADMSG: 94,
				EBUSY: 16,
				ECANCELED: 89,
				ECHILD: 10,
				ECONNABORTED: 53,
				ECONNREFUSED: 61,
				ECONNRESET: 54,
				EDEADLK: 11,
				EDESTADDRREQ: 39,
				EDOM: 33,
				EDQUOT: 69,
				EEXIST: 17,
				EFAULT: 14,
				EFBIG: 27,
				EHOSTUNREACH: 65,
				EIDRM: 90,
				EILSEQ: 92,
				EINPROGRESS: 36,
				EINTR: 4,
				EINVAL: 22,
				EIO: 5,
				EISCONN: 56,
				EISDIR: 21,
				ELOOP: 62,
				EMFILE: 24,
				EMLINK: 31,
				EMSGSIZE: 40,
				EMULTIHOP: 95,
				ENAMETOOLONG: 63,
				ENETDOWN: 50,
				ENETRESET: 52,
				ENETUNREACH: 51,
				ENFILE: 23,
				ENOBUFS: 55,
				ENODATA: 96,
				ENODEV: 19,
				ENOENT: 2,
				ENOEXEC: 8,
				ENOLCK: 77,
				ENOLINK: 97,
				ENOMEM: 12,
				ENOMSG: 91,
				ENOPROTOOPT: 42,
				ENOSPC: 28,
				ENOSR: 98,
				ENOSTR: 99,
				ENOSYS: 78,
				ENOTCONN: 57,
				ENOTDIR: 20,
				ENOTEMPTY: 66,
				ENOTSOCK: 38,
				ENOTSUP: 45,
				ENOTTY: 25,
				ENXIO: 6,
				EOPNOTSUPP: 102,
				EOVERFLOW: 84,
				EPERM: 1,
				EPIPE: 32,
				EPROTO: 100,
				EPROTONOSUPPORT: 43,
				EPROTOTYPE: 41,
				ERANGE: 34,
				EROFS: 30,
				ESPIPE: 29,
				ESRCH: 3,
				ESTALE: 70,
				ETIME: 101,
				ETIMEDOUT: 60,
				ETXTBSY: 26,
				EWOULDBLOCK: 35,
				EXDEV: 18,
			},
			signals: {
				SIGHUP: 1,
				SIGINT: 2,
				SIGQUIT: 3,
				SIGILL: 4,
				SIGTRAP: 5,
				SIGABRT: 6,
				SIGIOT: 6,
				SIGBUS: 10,
				SIGFPE: 8,
				SIGKILL: 9,
				SIGUSR1: 30,
				SIGSEGV: 11,
				SIGUSR2: 31,
				SIGPIPE: 13,
				SIGALRM: 14,
				SIGTERM: 15,
				SIGCHLD: 20,
				SIGCONT: 19,
				SIGSTOP: 17,
				SIGTSTP: 18,
				SIGTTIN: 21,
				SIGTTOU: 22,
				SIGURG: 16,
				SIGXCPU: 24,
				SIGXFSZ: 25,
				SIGVTALRM: 26,
				SIGPROF: 27,
				SIGWINCH: 28,
				SIGIO: 23,
				SIGINFO: 29,
				SIGSYS: 12,
			},
			priority: {
				PRIORITY_LOW: 19,
				PRIORITY_BELOW_NORMAL: 10,
				PRIORITY_NORMAL: 0,
				PRIORITY_ABOVE_NORMAL: -7,
				PRIORITY_HIGH: -14,
				PRIORITY_HIGHEST: -20,
			},
		},
		sqlite: {
			SQLITE_CHANGESET_OMIT: 0,
			SQLITE_CHANGESET_REPLACE: 1,
			SQLITE_CHANGESET_ABORT: 2,
		},
		http: {
			HPE_OK: 0,
			HPE_INTERNAL: 1,
			HPE_STRICT: 2,
			HPE_CR_EXPECTED: 25,
			HPE_LF_EXPECTED: 3,
			HPE_UNEXPECTED_CONTENT_LENGTH: 4,
			HPE_UNEXPECTED_SPACE: 30,
			HPE_CLOSED_CONNECTION: 5,
			HPE_INVALID_METHOD: 6,
			HPE_INVALID_URL: 7,
			HPE_INVALID_CONSTANT: 8,
			HPE_INVALID_VERSION: 9,
			HPE_INVALID_HEADER_TOKEN: 10,
			HPE_INVALID_CONTENT_LENGTH: 11,
			HPE_INVALID_CHUNK_SIZE: 12,
			HPE_INVALID_STATUS: 13,
			HPE_INVALID_EOF_STATE: 14,
			HPE_INVALID_TRANSFER_ENCODING: 15,
			HPE_CB_MESSAGE_BEGIN: 16,
			HPE_CB_HEADERS_COMPLETE: 17,
			HPE_CB_MESSAGE_COMPLETE: 18,
			HPE_CB_CHUNK_HEADER: 19,
			HPE_CB_CHUNK_COMPLETE: 20,
			HPE_PAUSED: 21,
			HPE_PAUSED_UPGRADE: 22,
			HPE_PAUSED_H2_UPGRADE: 23,
			HPE_USER: 24,
			HPE_CB_URL_COMPLETE: 26,
			HPE_CB_STATUS_COMPLETE: 27,
			HPE_CB_METHOD_COMPLETE: 32,
			HPE_CB_VERSION_COMPLETE: 33,
			HPE_CB_HEADER_FIELD_COMPLETE: 28,
			HPE_CB_HEADER_VALUE_COMPLETE: 29,
			HPE_CB_CHUNK_EXTENSION_NAME_COMPLETE: 34,
			HPE_CB_CHUNK_EXTENSION_VALUE_COMPLETE: 35,
			HPE_CB_RESET: 31,
			HPE_CB_PROTOCOL_COMPLETE: 38,
			F_CONNECTION_KEEP_ALIVE: 0x1,
			F_CONNECTION_CLOSE: 0x2,
			F_CONNECTION_UPGRADE: 0x4,
			F_CHUNKED: 0x8,
			F_UPGRADE: 0x10,
			F_CONTENT_LENGTH: 0x20,
			F_SKIPBODY: 0x40,
			F_TRAILING: 0x80,
			F_TRANSFER_ENCODING: 0x200,
			LENIENT_HEADERS: 0x1,
			LENIENT_CHUNKED_LENGTH: 0x2,
			LENIENT_KEEP_ALIVE: 0x4,
			LENIENT_TRANSFER_ENCODING: 0x8,
			LENIENT_VERSION: 0x10,
			LENIENT_DATA_AFTER_CLOSE: 0x20,
			LENIENT_OPTIONAL_LF_AFTER_CR: 0x40,
			LENIENT_OPTIONAL_CRLF_AFTER_CHUNK: 0x80,
			LENIENT_OPTIONAL_CR_BEFORE_LF: 0x100,
			LENIENT_SPACES_AFTER_CHUNK_SIZE: 0x200,
			HTTP_BOTH: 0,
			HTTP_REQUEST: 1,
			HTTP_RESPONSE: 2,
			HTTP_FINISH_SAFE: 0,
			HTTP_FINISH_SAFE_WITH_CB: 1,
			HTTP_FINISH_UNSAFE: 2,
			HTTP_DELETE: 0,
			HTTP_GET: 1,
			HTTP_HEAD: 2,
			HTTP_POST: 3,
			HTTP_PUT: 4,
			HTTP_CONNECT: 5,
			HTTP_OPTIONS: 6,
			HTTP_TRACE: 7,
			HTTP_COPY: 8,
			HTTP_LOCK: 9,
			HTTP_MKCOL: 10,
			HTTP_MOVE: 11,
			HTTP_PROPFIND: 12,
			HTTP_PROPPATCH: 13,
			HTTP_SEARCH: 14,
			HTTP_UNLOCK: 15,
			HTTP_BIND: 16,
			HTTP_REBIND: 17,
			HTTP_UNBIND: 18,
			HTTP_ACL: 19,
			HTTP_REPORT: 20,
			HTTP_MKACTIVITY: 21,
			HTTP_CHECKOUT: 22,
			HTTP_MERGE: 23,
			HTTP_MSEARCH: 24,
			HTTP_NOTIFY: 25,
			HTTP_SUBSCRIBE: 26,
			HTTP_UNSUBSCRIBE: 27,
			HTTP_PATCH: 28,
			HTTP_PURGE: 29,
			HTTP_MKCALENDAR: 30,
			HTTP_LINK: 31,
			HTTP_UNLINK: 32,
			HTTP_SOURCE: 33,
			HTTP_PRI: 34,
			HTTP_DESCRIBE: 35,
			HTTP_ANNOUNCE: 36,
			HTTP_SETUP: 37,
			HTTP_PLAY: 38,
			HTTP_PAUSE: 39,
			HTTP_TEARDOWN: 40,
			HTTP_GET_PARAMETER: 41,
			HTTP_SET_PARAMETER: 42,
			HTTP_REDIRECT: 43,
			HTTP_RECORD: 44,
			HTTP_FLUSH: 45,
			HTTP_QUERY: 46,
			HTTP_STATUS_CONTINUE: 100,
			HTTP_STATUS_SWITCHING_PROTOCOLS: 101,
			HTTP_STATUS_PROCESSING: 102,
			HTTP_STATUS_EARLY_HINTS: 103,
			HTTP_STATUS_RESPONSE_IS_STALE: 110,
			HTTP_STATUS_REVALIDATION_FAILED: 111,
			HTTP_STATUS_DISCONNECTED_OPERATION: 112,
			HTTP_STATUS_HEURISTIC_EXPIRATION: 113,
			HTTP_STATUS_MISCELLANEOUS_WARNING: 199,
			HTTP_STATUS_OK: 200,
			HTTP_STATUS_CREATED: 201,
			HTTP_STATUS_ACCEPTED: 202,
			HTTP_STATUS_NON_AUTHORITATIVE_INFORMATION: 203,
			HTTP_STATUS_NO_CONTENT: 204,
			HTTP_STATUS_RESET_CONTENT: 205,
			HTTP_STATUS_PARTIAL_CONTENT: 206,
			HTTP_STATUS_MULTI_STATUS: 207,
			HTTP_STATUS_ALREADY_REPORTED: 208,
			HTTP_STATUS_TRANSFORMATION_APPLIED: 214,
			HTTP_STATUS_IM_USED: 226,
			HTTP_STATUS_MISCELLANEOUS_PERSISTENT_WARNING: 299,
			HTTP_STATUS_MULTIPLE_CHOICES: 300,
			HTTP_STATUS_MOVED_PERMANENTLY: 301,
			HTTP_STATUS_FOUND: 302,
			HTTP_STATUS_SEE_OTHER: 303,
			HTTP_STATUS_NOT_MODIFIED: 304,
			HTTP_STATUS_USE_PROXY: 305,
			HTTP_STATUS_SWITCH_PROXY: 306,
			HTTP_STATUS_TEMPORARY_REDIRECT: 307,
			HTTP_STATUS_PERMANENT_REDIRECT: 308,
			HTTP_STATUS_BAD_REQUEST: 400,
			HTTP_STATUS_UNAUTHORIZED: 401,
			HTTP_STATUS_PAYMENT_REQUIRED: 402,
			HTTP_STATUS_FORBIDDEN: 403,
			HTTP_STATUS_NOT_FOUND: 404,
			HTTP_STATUS_METHOD_NOT_ALLOWED: 405,
			HTTP_STATUS_NOT_ACCEPTABLE: 406,
			HTTP_STATUS_PROXY_AUTHENTICATION_REQUIRED: 407,
			HTTP_STATUS_REQUEST_TIMEOUT: 408,
			HTTP_STATUS_CONFLICT: 409,
			HTTP_STATUS_GONE: 410,
			HTTP_STATUS_LENGTH_REQUIRED: 411,
			HTTP_STATUS_PRECONDITION_FAILED: 412,
			HTTP_STATUS_PAYLOAD_TOO_LARGE: 413,
			HTTP_STATUS_URI_TOO_LONG: 414,
			HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE: 415,
			HTTP_STATUS_RANGE_NOT_SATISFIABLE: 416,
			HTTP_STATUS_EXPECTATION_FAILED: 417,
			HTTP_STATUS_IM_A_TEAPOT: 418,
			HTTP_STATUS_PAGE_EXPIRED: 419,
			HTTP_STATUS_ENHANCE_YOUR_CALM: 420,
			HTTP_STATUS_MISDIRECTED_REQUEST: 421,
			HTTP_STATUS_UNPROCESSABLE_ENTITY: 422,
			HTTP_STATUS_LOCKED: 423,
			HTTP_STATUS_FAILED_DEPENDENCY: 424,
			HTTP_STATUS_TOO_EARLY: 425,
			HTTP_STATUS_UPGRADE_REQUIRED: 426,
			HTTP_STATUS_PRECONDITION_REQUIRED: 428,
			HTTP_STATUS_TOO_MANY_REQUESTS: 429,
			HTTP_STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE_UNOFFICIAL: 430,
			HTTP_STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
			HTTP_STATUS_LOGIN_TIMEOUT: 440,
			HTTP_STATUS_NO_RESPONSE: 444,
			HTTP_STATUS_RETRY_WITH: 449,
			HTTP_STATUS_BLOCKED_BY_PARENTAL_CONTROL: 450,
			HTTP_STATUS_UNAVAILABLE_FOR_LEGAL_REASONS: 451,
			HTTP_STATUS_CLIENT_CLOSED_LOAD_BALANCED_REQUEST: 460,
			HTTP_STATUS_INVALID_X_FORWARDED_FOR: 463,
			HTTP_STATUS_REQUEST_HEADER_TOO_LARGE: 494,
			HTTP_STATUS_SSL_CERTIFICATE_ERROR: 495,
			HTTP_STATUS_SSL_CERTIFICATE_REQUIRED: 496,
			HTTP_STATUS_HTTP_REQUEST_SENT_TO_HTTPS_PORT: 497,
			HTTP_STATUS_INVALID_TOKEN: 498,
			HTTP_STATUS_CLIENT_CLOSED_REQUEST: 499,
			HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
			HTTP_STATUS_NOT_IMPLEMENTED: 501,
			HTTP_STATUS_BAD_GATEWAY: 502,
			HTTP_STATUS_SERVICE_UNAVAILABLE: 503,
			HTTP_STATUS_GATEWAY_TIMEOUT: 504,
			HTTP_STATUS_HTTP_VERSION_NOT_SUPPORTED: 505,
			HTTP_STATUS_VARIANT_ALSO_NEGOTIATES: 506,
			HTTP_STATUS_INSUFFICIENT_STORAGE: 507,
			HTTP_STATUS_LOOP_DETECTED: 508,
			HTTP_STATUS_BANDWIDTH_LIMIT_EXCEEDED: 509,
			HTTP_STATUS_NOT_EXTENDED: 510,
			HTTP_STATUS_NETWORK_AUTHENTICATION_REQUIRED: 511,
			HTTP_STATUS_WEB_SERVER_UNKNOWN_ERROR: 520,
			HTTP_STATUS_WEB_SERVER_IS_DOWN: 521,
			HTTP_STATUS_CONNECTION_TIMEOUT: 522,
			HTTP_STATUS_ORIGIN_IS_UNREACHABLE: 523,
			HTTP_STATUS_TIMEOUT_OCCURED: 524,
			HTTP_STATUS_SSL_HANDSHAKE_FAILED: 525,
			HTTP_STATUS_INVALID_SSL_CERTIFICATE: 526,
			HTTP_STATUS_RAILGUN_ERROR: 527,
			HTTP_STATUS_SITE_IS_OVERLOADED: 529,
			HTTP_STATUS_SITE_IS_FROZEN: 530,
			HTTP_STATUS_IDENTITY_PROVIDER_AUTHENTICATION_ERROR: 561,
			HTTP_STATUS_NETWORK_READ_TIMEOUT: 598,
			HTTP_STATUS_NETWORK_CONNECT_TIMEOUT: 599,
		},
		fs: {
			UV_FS_SYMLINK_DIR: 1,
			UV_FS_SYMLINK_JUNCTION: 2,
			O_RDONLY: 0,
			O_WRONLY: 1,
			O_RDWR: 2,
			UV_DIRENT_UNKNOWN: 0,
			UV_DIRENT_FILE: 1,
			UV_DIRENT_DIR: 2,
			UV_DIRENT_LINK: 3,
			UV_DIRENT_FIFO: 4,
			UV_DIRENT_SOCKET: 5,
			UV_DIRENT_CHAR: 6,
			UV_DIRENT_BLOCK: 7,
			S_IFMT: 61440,
			S_IFREG: 32768,
			S_IFDIR: 16384,
			S_IFCHR: 8192,
			S_IFBLK: 24576,
			S_IFIFO: 4096,
			S_IFLNK: 40960,
			S_IFSOCK: 49152,
			O_CREAT: 512,
			O_EXCL: 2048,
			UV_FS_O_FILEMAP: 0,
			O_NOCTTY: 131072,
			O_TRUNC: 1024,
			O_APPEND: 8,
			O_DIRECTORY: 1048576,
			O_NOFOLLOW: 256,
			O_SYNC: 128,
			O_DSYNC: 4194304,
			O_SYMLINK: 2097152,
			O_NONBLOCK: 4,
			S_IRWXU: 448,
			S_IRUSR: 256,
			S_IWUSR: 128,
			S_IXUSR: 64,
			S_IRWXG: 56,
			S_IRGRP: 32,
			S_IWGRP: 16,
			S_IXGRP: 8,
			S_IRWXO: 7,
			S_IROTH: 4,
			S_IWOTH: 2,
			S_IXOTH: 1,
			F_OK: 0,
			R_OK: 4,
			W_OK: 2,
			X_OK: 1,
			UV_FS_COPYFILE_EXCL: 1,
			COPYFILE_EXCL: 1,
			UV_FS_COPYFILE_FICLONE: 2,
			COPYFILE_FICLONE: 2,
			UV_FS_COPYFILE_FICLONE_FORCE: 4,
			COPYFILE_FICLONE_FORCE: 4,
		},
		crypto: {
			OPENSSL_VERSION_NUMBER: 269488319,
			SSL_OP_ALL: 2147485780,
			SSL_OP_ALLOW_NO_DHE_KEX: 1024,
			SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: 262144,
			SSL_OP_CIPHER_SERVER_PREFERENCE: 4194304,
			SSL_OP_CISCO_ANYCONNECT: 32768,
			SSL_OP_COOKIE_EXCHANGE: 8192,
			SSL_OP_CRYPTOPRO_TLSEXT_BUG: 2147483648,
			SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: 2048,
			SSL_OP_LEGACY_SERVER_CONNECT: 4,
			SSL_OP_NO_COMPRESSION: 131072,
			SSL_OP_NO_ENCRYPT_THEN_MAC: 524288,
			SSL_OP_NO_QUERY_MTU: 4096,
			SSL_OP_NO_RENEGOTIATION: 1073741824,
			SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: 65536,
			SSL_OP_NO_SSLv2: 0,
			SSL_OP_NO_SSLv3: 33554432,
			SSL_OP_NO_TICKET: 16384,
			SSL_OP_NO_TLSv1: 67108864,
			SSL_OP_NO_TLSv1_1: 268435456,
			SSL_OP_NO_TLSv1_2: 134217728,
			SSL_OP_NO_TLSv1_3: 536870912,
			SSL_OP_PRIORITIZE_CHACHA: 2097152,
			SSL_OP_TLS_ROLLBACK_BUG: 8388608,
			ENGINE_METHOD_RSA: 1,
			ENGINE_METHOD_DSA: 2,
			ENGINE_METHOD_DH: 4,
			ENGINE_METHOD_RAND: 8,
			ENGINE_METHOD_EC: 2048,
			ENGINE_METHOD_CIPHERS: 64,
			ENGINE_METHOD_DIGESTS: 128,
			ENGINE_METHOD_PKEY_METHS: 512,
			ENGINE_METHOD_PKEY_ASN1_METHS: 1024,
			ENGINE_METHOD_ALL: 65535,
			ENGINE_METHOD_NONE: 0,
			DH_CHECK_P_NOT_SAFE_PRIME: 2,
			DH_CHECK_P_NOT_PRIME: 1,
			DH_UNABLE_TO_CHECK_GENERATOR: 4,
			DH_NOT_SUITABLE_GENERATOR: 8,
			RSA_PKCS1_PADDING: 1,
			RSA_SSLV23_PADDING: 2,
			RSA_NO_PADDING: 3,
			RSA_PKCS1_OAEP_PADDING: 4,
			RSA_X931_PADDING: 5,
			RSA_PKCS1_PSS_PADDING: 6,
			RSA_PSS_SALTLEN_DIGEST: -1,
			RSA_PSS_SALTLEN_MAX_SIGN: -2,
			RSA_PSS_SALTLEN_AUTO: -2,
			defaultCoreCipherList:
				'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA',
			TLS1_VERSION: 769,
			TLS1_1_VERSION: 770,
			TLS1_2_VERSION: 771,
			TLS1_3_VERSION: 772,
			POINT_CONVERSION_COMPRESSED: 2,
			POINT_CONVERSION_UNCOMPRESSED: 4,
			POINT_CONVERSION_HYBRID: 6,
		},
		zlib: {
			Z_NO_FLUSH: 0,
			Z_PARTIAL_FLUSH: 1,
			Z_SYNC_FLUSH: 2,
			Z_FULL_FLUSH: 3,
			Z_FINISH: 4,
			Z_BLOCK: 5,
			Z_OK: 0,
			Z_STREAM_END: 1,
			Z_NEED_DICT: 2,
			Z_ERRNO: -1,
			Z_STREAM_ERROR: -2,
			Z_DATA_ERROR: -3,
			Z_MEM_ERROR: -4,
			Z_BUF_ERROR: -5,
			Z_VERSION_ERROR: -6,
			Z_NO_COMPRESSION: 0,
			Z_BEST_SPEED: 1,
			Z_BEST_COMPRESSION: 9,
			Z_DEFAULT_COMPRESSION: -1,
			Z_FILTERED: 1,
			Z_HUFFMAN_ONLY: 2,
			Z_RLE: 3,
			Z_FIXED: 4,
			Z_DEFAULT_STRATEGY: 0,
			ZLIB_VERNUM: 4784,
			DEFLATE: 1,
			INFLATE: 2,
			GZIP: 3,
			GUNZIP: 4,
			DEFLATERAW: 5,
			INFLATERAW: 6,
			UNZIP: 7,
			BROTLI_DECODE: 8,
			BROTLI_ENCODE: 9,
			ZSTD_COMPRESS: 10,
			ZSTD_DECOMPRESS: 11,
			ZSTD_e_continue: 0,
			ZSTD_e_flush: 1,
			ZSTD_e_end: 2,
			Z_MIN_WINDOWBITS: 8,
			Z_MAX_WINDOWBITS: 15,
			Z_DEFAULT_WINDOWBITS: 15,
			Z_MIN_CHUNK: 64,
			Z_MAX_CHUNK: 2147483647,
			Z_DEFAULT_CHUNK: 16384,
			Z_MIN_MEMLEVEL: 1,
			Z_MAX_MEMLEVEL: 9,
			Z_DEFAULT_MEMLEVEL: 8,
			Z_MIN_LEVEL: -1,
			Z_MAX_LEVEL: 9,
			Z_DEFAULT_LEVEL: -1,
			BROTLI_OPERATION_PROCESS: 0,
			BROTLI_OPERATION_FLUSH: 1,
			BROTLI_OPERATION_FINISH: 2,
			BROTLI_OPERATION_EMIT_METADATA: 3,
			BROTLI_PARAM_MODE: 0,
			BROTLI_MODE_GENERIC: 0,
			BROTLI_MODE_TEXT: 1,
			BROTLI_MODE_FONT: 2,
			BROTLI_DEFAULT_MODE: 0,
			BROTLI_PARAM_QUALITY: 1,
			BROTLI_MIN_QUALITY: 0,
			BROTLI_MAX_QUALITY: 11,
			BROTLI_DEFAULT_QUALITY: 11,
			BROTLI_PARAM_LGWIN: 2,
			BROTLI_MIN_WINDOW_BITS: 10,
			BROTLI_MAX_WINDOW_BITS: 24,
			BROTLI_LARGE_MAX_WINDOW_BITS: 30,
			BROTLI_DEFAULT_WINDOW: 22,
			BROTLI_PARAM_LGBLOCK: 3,
			BROTLI_MIN_INPUT_BLOCK_BITS: 16,
			BROTLI_MAX_INPUT_BLOCK_BITS: 24,
			BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: 4,
			BROTLI_PARAM_SIZE_HINT: 5,
			BROTLI_PARAM_LARGE_WINDOW: 6,
			BROTLI_PARAM_NPOSTFIX: 7,
			BROTLI_PARAM_NDIRECT: 8,
			BROTLI_DECODER_RESULT_ERROR: 0,
			BROTLI_DECODER_RESULT_SUCCESS: 1,
			BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT: 2,
			BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT: 3,
			BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: 0,
			BROTLI_DECODER_PARAM_LARGE_WINDOW: 1,
			BROTLI_DECODER_NO_ERROR: 0,
			BROTLI_DECODER_SUCCESS: 1,
			BROTLI_DECODER_NEEDS_MORE_INPUT: 2,
			BROTLI_DECODER_NEEDS_MORE_OUTPUT: 3,
			BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE: -1,
			BROTLI_DECODER_ERROR_FORMAT_RESERVED: -2,
			BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE: -3,
			BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET: -4,
			BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME: -5,
			BROTLI_DECODER_ERROR_FORMAT_CL_SPACE: -6,
			BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE: -7,
			BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT: -8,
			BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1: -9,
			BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2: -10,
			BROTLI_DECODER_ERROR_FORMAT_TRANSFORM: -11,
			BROTLI_DECODER_ERROR_FORMAT_DICTIONARY: -12,
			BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS: -13,
			BROTLI_DECODER_ERROR_FORMAT_PADDING_1: -14,
			BROTLI_DECODER_ERROR_FORMAT_PADDING_2: -15,
			BROTLI_DECODER_ERROR_FORMAT_DISTANCE: -16,
			BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET: -19,
			BROTLI_DECODER_ERROR_INVALID_ARGUMENTS: -20,
			BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES: -21,
			BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS: -22,
			BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP: -25,
			BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1: -26,
			BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2: -27,
			BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES: -30,
			BROTLI_DECODER_ERROR_UNREACHABLE: -31,
		},
		trace: {
			TRACE_EVENT_PHASE_BEGIN: 66,
			TRACE_EVENT_PHASE_END: 69,
			TRACE_EVENT_PHASE_COMPLETE: 88,
			TRACE_EVENT_PHASE_INSTANT: 73,
			TRACE_EVENT_PHASE_ASYNC_BEGIN: 83,
			TRACE_EVENT_PHASE_ASYNC_STEP_INTO: 84,
			TRACE_EVENT_PHASE_ASYNC_STEP_PAST: 112,
			TRACE_EVENT_PHASE_ASYNC_END: 70,
			TRACE_EVENT_PHASE_NESTABLE_ASYNC_BEGIN: 98,
			TRACE_EVENT_PHASE_NESTABLE_ASYNC_END: 101,
			TRACE_EVENT_PHASE_NESTABLE_ASYNC_INSTANT: 110,
			TRACE_EVENT_PHASE_FLOW_BEGIN: 115,
			TRACE_EVENT_PHASE_FLOW_STEP: 116,
			TRACE_EVENT_PHASE_FLOW_END: 102,
			TRACE_EVENT_PHASE_METADATA: 77,
			TRACE_EVENT_PHASE_COUNTER: 67,
			TRACE_EVENT_PHASE_SAMPLE: 80,
			TRACE_EVENT_PHASE_CREATE_OBJECT: 78,
			TRACE_EVENT_PHASE_SNAPSHOT_OBJECT: 79,
			TRACE_EVENT_PHASE_DELETE_OBJECT: 68,
			TRACE_EVENT_PHASE_MEMORY_DUMP: 118,
			TRACE_EVENT_PHASE_MARK: 82,
			TRACE_EVENT_PHASE_CLOCK_SYNC: 99,
			TRACE_EVENT_PHASE_ENTER_CONTEXT: 40,
			TRACE_EVENT_PHASE_LEAVE_CONTEXT: 41,
			TRACE_EVENT_PHASE_LINK_IDS: 61,
		},
		internal: {
			EXTENSIONLESS_FORMAT_JAVASCRIPT: 0,
			EXTENSIONLESS_FORMAT_WASM: 1,
		},
	},
	// @TODO: Implement those modules
	module_wrap: {
		ModuleWrap: class ModuleWrap {
			constructor() {
				this.exports = {};
			}
		},
	},
	block_list: {
		schemelessBlockList: new Set([]),
		BlockList: class BlockList {
			constructor() {
				this.schemelessBlockList = new Set([]);
			}
		},
	},
};

Object.assign(
	globalThis.internalModules.constants,
	globalThis.internalModules.constants.fs
);

globalThis.internalModules.os.constants =
	globalThis.internalModules.constants.os;
globalThis.internalModules.os.default = globalThis.internalModules.os;

await import('../../dist/primordials.js');
// import * as myPrimordials from "./src/this-is-imported-directly/primordials.js";
// globalThis.primordials = { ...myPrimordials, ...globalThis.primordials };
// console.log(globalThis.primordials);

globalThis.getInternalBinding = globalThis.internalBinding = function (
	moduleName
) {
	if (globalThis.internalModules[moduleName]) {
		const module = globalThis.internalModules[moduleName];
		if (moduleName === 'errors') {
			return { ...module, exitCodes: module.codes };
		}
		return module;
	}
	throw new Error(`Unknown module "${moduleName}"`);
};
globalThis.coreModules = {};

const process = (await import('../../dist/process.js')).default;
globalThis.process = { ...process };
globalThis.coreModules.process = globalThis.process;

const types = await import('../../dist/internal/types.js');
globalThis.internalModules.util = {
	types: { ...types },
	...globalThis.internalModules.util,
};
globalThis.internalModules.types = {
	...globalThis.internalModules.types,
	...types,
};

const internalConstants = await import('../../dist/internal/constants.js');
globalThis.internalModules.constants = {
	...globalThis.internalModules.constants,
	...internalConstants,
	os: {
		errno: {
			EINVAL: 22,
			EACCES: 13,
			ENOENT: 2,
			ENOTDIR: 20,
			ENOTEMPTY: 66,
			EEXIST: 17,
			EROFS: 30,
			EISDIR: 21,
			ETIMEDOUT: 60,
			ECONNREFUSED: 61,
			ECONNRESET: 54,
			ECONNABORTED: 53,
			ECONNREFUSED: 61,
			ECONNRESET: 54,
		},
	},
};
globalThis.coreModules.constants = globalThis.internalModules.constants;
globalThis.internalModules.util = {
	constants: { ...internalConstants },
	...globalThis.internalModules.util,
};

const CryptoInternal = await import('../../dist/crypto.js');
globalThis.internalModules.crypto = {
	startLoadingCertificatesOffThread() {
		return;
	}, // throw new Error('Not implemented')},
	createNativeKeyObjectClass() {
		return [null, null, null, null];
	},
	...globalThis.internalModules.crypto,
	...CryptoInternal.default,
};
const buffer = await import('../../dist/buffer.js');
globalThis.internalModules.buffer = {
	buffer: { ...buffer },
	...globalThis.internalModules.buffer,
};
globalThis.coreModules.buffer = buffer;
globalThis.buffer = buffer.Buffer;
globalThis.Buffer = buffer.Buffer;

const stringDecoder = await import('../../dist/string_decoder.js');
globalThis.internalModules.string_decoder = {
	stringDecoder: { ...stringDecoder },
	...globalThis.internalModules.string_decoder,
};
globalThis.coreModules.string_decoder = stringDecoder.default;

const inspect = await import('../../dist/util/inspect.js');
globalThis.internalModules.util = {
	inspect: { ...inspect },
	...globalThis.internalModules.util,
};

const util = await import('../../dist/util.js');
globalThis.internalModules.util = {
	...globalThis.internalModules.util,
	...util,
	encodingsMap: globalThis.internalModules.string_decoder.encodings,
};
globalThis.coreModules.util = util.default;
globalThis.coreModules.util.encodingsMap =
	globalThis.internalModules.string_decoder.encodings;

const errors = await import('../../dist/errors.js');
globalThis.internalModules.errors = {
	...globalThis.internalModules.errors,
	...errors.default,
	codes: errors.default.codes,
};

const realm = await import('../../dist/realm.js');
globalThis.realm = { ...realm };

const path = await import('../../dist/path.js');
globalThis.coreModules.path = path.default;

const stream = await import('../../dist/stream.js');
globalThis.coreModules.stream = stream.default;

const asyncHooks = await import('../../dist/async_hooks.js');
globalThis.coreModules.async_hooks = asyncHooks.default;

const debuglog = await import('../../dist/internal/util/debuglog.js');
globalThis.internalModules.util = {
	...globalThis.internalModules.util,
	debuglog: debuglog.default,
};
debuglog.default.initializeDebugEnv('debug');

globalThis.coreModules.os = globalThis.internalModules.os;

// Node Response class has an abort method.
// globalThis.Response.prototype.abort = () => {
// 	// do nothing
// };

const blob = await import('../../dist/blob.js');
globalThis.coreModules.blob = blob.default;

const fs = await import('../../dist/fs.js');

// Register internal/fs/dir module for lazy loading
// Use the Dir class we implemented in fs_dir binding
globalThis.__moduleRegistry.set('internal/fs/dir', {
	Dir: globalThis.internalModules.fs_dir.Dir,
	opendir: fs.default.opendir,
	opendirSync: fs.default.opendirSync,
});

// Also expose in internalModules for other code that might need it
globalThis.internalModules.fs_dir_exports =
	globalThis.__moduleRegistry.get('internal/fs/dir');

globalThis.coreModules.fs = fs.default;

const fsPromises = await import('../../dist/fs/promises.js');
globalThis.coreModules['fs/promises'] = fsPromises.default.exports;
globalThis.coreModules['fs'].FileHandle = fsPromises.default.FileHandle;

// Make fs.promises.opendir usable directly in for await...of by returning
// a thenable that is also async-iterable
{
	const fsp = globalThis.coreModules['fs/promises'];
	const originalOpendir = fsp && fsp.opendir;
	if (typeof originalOpendir === 'function') {
		fsp.opendir = function (...args) {
			return globalThis.internalModules.fs_dir.opendir(...args);
		};
	}
}

const events = await import('../../dist/events.js');
globalThis.coreModules.events = events.default;

const event_target = await import('../../dist/internal/event_target.js');
globalThis.internalModules.event_target = event_target.default;

const setupMessagingBinding = () => {
	const { EventEmitter } = events.default;
	const symbols = globalThis.internalModules.symbols ?? {};
	const noMessageSymbol =
		symbols.no_message ?? Symbol.for('nodejs.internal.no_message');

	const nativePortSymbol = Symbol('nativePort');
	const startedSymbol = Symbol('started');
	const pendingSymbol = Symbol('pendingMessages');
	const refSymbol = Symbol('refed');
	const closedSymbol = Symbol('closed');
	const onMessageSymbol = Symbol('onMessageHandler');
	const onMessageErrorSymbol = Symbol('onMessageErrorHandler');

	const wrapperForNativePort = new WeakMap();

	function isPlainObject(value) {
		if (!value || typeof value !== 'object') {
			return false;
		}
		const proto = Object.getPrototypeOf(value);
		return proto === Object.prototype || proto === null;
	}

	function unwrapPortValue(value, seen = new WeakMap()) {
		if (!value || typeof value !== 'object') {
			return value;
		}

		if (value[nativePortSymbol]) {
			return value[nativePortSymbol];
		}

		if (value instanceof globalThis.MessagePort) {
			return value;
		}

		if (seen.has(value)) {
			return seen.get(value);
		}

		if (Array.isArray(value)) {
			const result = [];
			seen.set(value, result);
			for (let i = 0; i < value.length; i++) {
				result[i] = unwrapPortValue(value[i], seen);
			}
			return result;
		}

		if (isPlainObject(value)) {
			const result = {};
			seen.set(value, result);
			for (const [key, entry] of Object.entries(value)) {
				result[key] = unwrapPortValue(entry, seen);
			}
			return result;
		}

		return value;
	}

	function wrapPortValue(value, seen = new WeakMap()) {
		if (!value || typeof value !== 'object') {
			return value;
		}

		if (value instanceof MessagePortImpl) {
			return value;
		}

		if (value instanceof globalThis.MessagePort) {
			return ensurePort(value);
		}

		if (seen.has(value)) {
			return seen.get(value);
		}

		if (Array.isArray(value)) {
			const result = [];
			seen.set(value, result);
			for (let i = 0; i < value.length; i++) {
				result[i] = wrapPortValue(value[i], seen);
			}
			return result;
		}

		if (isPlainObject(value)) {
			const result = {};
			seen.set(value, result);
			for (const [key, entry] of Object.entries(value)) {
				result[key] = wrapPortValue(entry, seen);
			}
			return result;
		}

		return value;
	}

	const toNativePort = (value) =>
		value && value[nativePortSymbol] ? value[nativePortSymbol] : value;

	const sanitizeTransferList = (list) => {
		if (!Array.isArray(list)) {
			return undefined;
		}
		return list
			.map((item) => toNativePort(item))
			.filter((item) => item != null);
	};

	class MessagePortImpl extends events.default.EventEmitter {
		constructor(nativePort) {
			super();
			this.addEventListener = this.addEventListener.bind(this);
			this.removeEventListener = this.removeEventListener.bind(this);
			this.dispatchEvent = this.dispatchEvent.bind(this);
			if (typeof globalThis.MessageChannel !== 'function') {
				throw new Error(
					'MessagePort is not supported in this environment'
				);
			}

			const port =
				nativePort instanceof globalThis.MessagePort
					? nativePort
					: new globalThis.MessageChannel().port1;

			this[nativePortSymbol] = port;
			this[startedSymbol] = false;
			this[refSymbol] = true;
			this[closedSymbol] = false;
			this[pendingSymbol] = [];

			this[onMessageSymbol] = (event) => {
				const data = wrapPortValue(event?.data);
				if (this[startedSymbol]) {
					(
						globalThis.queueMicrotask ??
						((fn) => Promise.resolve().then(fn))
					)(() => this.emit('message', data));
				} else {
					this[pendingSymbol].push({ type: 'message', data });
				}
			};
			this[onMessageErrorSymbol] = (event) => {
				const data = wrapPortValue(event?.data);
				if (this[startedSymbol]) {
					(
						globalThis.queueMicrotask ??
						((fn) => Promise.resolve().then(fn))
					)(() => this.emit('messageerror', data));
				} else {
					this[pendingSymbol].push({ type: 'messageerror', data });
				}
			};

			port.addEventListener('message', this[onMessageSymbol]);
			port.addEventListener('messageerror', this[onMessageErrorSymbol]);
			if (typeof port.start === 'function') {
				port.start();
			}

			wrapperForNativePort.set(port, this);
		}

		addEventListener(type, listener) {
			return this.on(type, listener);
		}

		removeEventListener(type, listener) {
			return this.off(type, listener);
		}

		dispatchEvent(event) {
			if (!event || typeof event.type !== 'string') {
				return false;
			}
			this.emit(event.type, event);
			return true;
		}

		start() {
			if (this[closedSymbol]) {
				return;
			}
			if (this[startedSymbol]) {
				return;
			}
			this[startedSymbol] = true;
			const pending = this[pendingSymbol].splice(0);
			for (const entry of pending) {
				(
					globalThis.queueMicrotask ??
					((fn) => Promise.resolve().then(fn))
				)(() => this.emit(entry.type, entry.data));
			}
		}

		postMessage(value, transferList) {
			if (this[closedSymbol]) {
				throw new Error('Cannot postMessage() on a closed MessagePort');
			}
			const nativeTransfer = sanitizeTransferList(transferList);
			const payload = unwrapPortValue(value);
			this[nativePortSymbol].postMessage(payload, nativeTransfer);
		}

		close() {
			if (this[closedSymbol]) {
				return;
			}
			this[closedSymbol] = true;
			try {
				this[nativePortSymbol].removeEventListener(
					'message',
					this[onMessageSymbol]
				);
				this[nativePortSymbol].removeEventListener(
					'messageerror',
					this[onMessageErrorSymbol]
				);
			} catch {
				// Ignore listener cleanup failures.
			}
			try {
				this[nativePortSymbol].close();
			} catch {
				// Ignore close failures.
			}
			this.emit('close');
		}

		ref() {
			this[refSymbol] = true;
			return this;
		}

		unref() {
			this[refSymbol] = false;
			return this;
		}

		hasRef() {
			return Boolean(this[refSymbol]);
		}

		drain() {
			this.start();
		}

		stop() {
			this[startedSymbol] = false;
		}

		dequeue() {
			const entry = this[pendingSymbol].shift();
			return entry ? entry.data : undefined;
		}
	}

	const ensurePort = (port) => {
		if (!port) {
			throw new TypeError('MessagePort expected');
		}
		if (port instanceof MessagePortImpl) {
			return port;
		}
		if (port instanceof globalThis.MessagePort) {
			const existing = wrapperForNativePort.get(port);
			return existing ?? new MessagePortImpl(port);
		}
		throw new TypeError('Unsupported MessagePort implementation');
	};

	class MessageChannelImpl {
		constructor() {
			if (typeof globalThis.MessageChannel !== 'function') {
				throw new Error(
					'MessageChannel is not supported in this environment'
				);
			}
			const channel = new globalThis.MessageChannel();
			this.port1 = ensurePort(channel.port1);
			this.port2 = ensurePort(channel.port2);
		}
	}

	class BroadcastChannelWrapper extends EventEmitter {
		constructor(name) {
			super();
			if (typeof globalThis.BroadcastChannel !== 'function') {
				throw new Error(
					'BroadcastChannel is not supported in this environment'
				);
			}
			this._channel = new globalThis.BroadcastChannel(String(name));
			this._refed = true;
			this._onMessage = (event) => this.emit('message', event?.data);
			this._onMessageError = (event) =>
				this.emit('messageerror', event?.data);
			this._channel.addEventListener('message', this._onMessage);
			this._channel.addEventListener(
				'messageerror',
				this._onMessageError
			);
		}

		postMessage(value) {
			this._channel.postMessage(value);
		}

		close() {
			try {
				this._channel.removeEventListener('message', this._onMessage);
				this._channel.removeEventListener(
					'messageerror',
					this._onMessageError
				);
			} catch {
				// Ignore cleanup failures.
			}
			this._channel.close();
		}

		ref() {
			this._refed = true;
			return this;
		}

		unref() {
			this._refed = false;
			return this;
		}
	}

	const broadcastChannelFactory = (name) => new BroadcastChannelWrapper(name);

	let deserializerFactory = null;

	const setDeserializerCreateObjectFunction = (fn) => {
		deserializerFactory = typeof fn === 'function' ? fn : null;
	};

	const structuredCloneImpl = (value, options) => {
		const transfer = Array.isArray(options?.transfer)
			? sanitizeTransferList(options.transfer)
			: undefined;
		if (typeof globalThis.structuredClone === 'function') {
			return globalThis.structuredClone(
				value,
				transfer ? { transfer } : undefined
			);
		}
		return JSON.parse(JSON.stringify(value));
	};

	const receiveMessageOnPortImpl = (port) => {
		const wrapper = ensurePort(port);
		const value = wrapper.dequeue();
		return value === undefined ? noMessageSymbol : value;
	};

	const drainMessagePortImpl = (port) => {
		ensurePort(port).drain();
	};

	const stopMessagePortImpl = (port) => {
		ensurePort(port).stop();
	};

	const moveMessagePortToContextImpl = (port) => ensurePort(port);

	const exposeLazyDOMExceptionProperty = (target) => {
		if (!target || typeof target !== 'object') {
			return;
		}
		if (
			!('DOMException' in target) &&
			typeof globalThis.DOMException === 'function'
		) {
			Object.defineProperty(target, 'DOMException', {
				configurable: true,
				enumerable: false,
				get() {
					return globalThis.DOMException;
				},
			});
		}
	};

	return {
		MessagePort: MessagePortImpl,
		MessageChannel: MessageChannelImpl,
		broadcastChannel: broadcastChannelFactory,
		ensurePort,
		drainMessagePort: drainMessagePortImpl,
		stopMessagePort: stopMessagePortImpl,
		receiveMessageOnPort: receiveMessageOnPortImpl,
		moveMessagePortToContext: moveMessagePortToContextImpl,
		setDeserializerCreateObjectFunction,
		structuredClone: structuredCloneImpl,
		DOMException: globalThis.DOMException,
		exposeLazyDOMExceptionProperty,
	};
};

globalThis.internalModules.messaging = setupMessagingBinding();
const messagingBinding = globalThis.internalModules.messaging;
const ensureNodeMessagePort =
	typeof messagingBinding.ensurePort === 'function'
		? messagingBinding.ensurePort
		: (value) => value;

const ensureNodeSpawnBridge = () => {
	const controller = globalThis.processController;
	if (!controller || typeof controller.spawn !== 'function') {
		throw new Error('processController.spawn is not available for Node runtime');
	}
	if (typeof controller.spawnNodeProcess === 'function') {
		return;
	}

	let counter = 0;
	const decoder = new TextDecoder();

	const sanitizeArgv = (input) => {
		if (!Array.isArray(input)) {
			return [];
		}
		return input.map((value) =>
			value == null ? '' : typeof value === 'string' ? value : String(value)
		);
	};

	const sanitizeEnv = (input) => {
		const result = {};
		if (!input || typeof input !== 'object') {
			return result;
		}
		for (const [key, value] of Object.entries(input)) {
			if (typeof key !== 'string' || key.length === 0) {
				continue;
			}
			result[key] =
				value == null ? '' : typeof value === 'string' ? value : String(value);
		}
		return result;
	};

	controller.spawnNodeProcess = function spawnNodeProcess(options = {}) {
		const argv = Array.isArray(options.argv)
			? sanitizeArgv(options.argv)
			: sanitizeArgv(
					Array.isArray(options.argvInput) ? options.argvInput : options.argv
			  );
		if (argv.length === 0) {
			throw new Error('spawnNodeProcess: argv must be a non-empty array of strings');
		}

		const env = {
			...(typeof controller.getAllEnv === 'function'
				? controller.getAllEnv()
				: {}),
			...sanitizeEnv(options.env),
		};

		const cwd =
			typeof options.cwd === 'string' && options.cwd.length
				? options.cwd
				: typeof controller.cwd === 'function'
				? controller.cwd()
				: '/';

		const resolvedName =
			typeof options.name === 'string' && options.name.length
				? options.name
				: typeof options.workerThreadName === 'string' && options.workerThreadName.length
				? options.workerThreadName
				: `node-process-${++counter}`;

		const spawnPromise = controller.spawn({
			argv,
			env,
			cwd,
			name: resolvedName,
			debug: Boolean(options.debug),
			stdio: {
				stdin:
					options.stdio?.stdin && typeof options.stdio.stdin === 'string'
						? options.stdio.stdin
						: 'pipe',
				stdout:
					options.stdio?.stdout && typeof options.stdio.stdout === 'string'
						? options.stdio.stdout
						: 'pipe',
				stderr:
					options.stdio?.stderr && typeof options.stdio.stderr === 'string'
						? options.stdio.stderr
						: 'pipe',
			},
			ipcPort:
				options.messagePort && typeof options.messagePort === 'object'
					? options.messagePort
					: undefined,
			workerThreadId:
				typeof options.workerThreadId === 'number'
					? options.workerThreadId
					: undefined,
			workerThreadName:
				typeof options.workerThreadName === 'string'
					? options.workerThreadName
					: resolvedName,
		});

		return spawnPromise
			.then((handle) => {
				const detachments = [];
				const normalizeChunk = (chunk) =>
					typeof chunk === 'string' ? chunk : decoder.decode(chunk);

				if (handle.stdout && typeof options.onStdout === 'function') {
					const listener = (chunk) => options.onStdout?.(normalizeChunk(chunk));
					const detach = handle.stdout.on('data', listener);
					detachments.push(() => {
						try {
							detach?.();
						} catch {
							// ignore
						}
					});
				}

				if (handle.stderr && typeof options.onStderr === 'function') {
					const listener = (chunk) => options.onStderr?.(normalizeChunk(chunk));
					const detach = handle.stderr.on('data', listener);
					detachments.push(() => {
						try {
							detach?.();
						} catch {
							// ignore
						}
					});
				}

				let messagePortListener = null;
				if (handle.messagePort && typeof options.onMessage === 'function') {
					messagePortListener = (event) => options.onMessage?.(event.data);
					handle.messagePort.addEventListener('message', messagePortListener);
					try {
						handle.messagePort.start();
					} catch {
						// optional start not supported
					}
					detachments.push(() => {
						if (!handle.messagePort || !messagePortListener) {
							return;
						}
						try {
							handle.messagePort.removeEventListener('message', messagePortListener);
						} catch {
							// ignore
						}
					});
				}

				let resolveExit;
				const exitPromise = new Promise((resolve) => {
					resolveExit = resolve;
				});

				const exitHandler = (code) => {
					const info = { code, signal: null };
					options.onExit?.(info);
					resolveExit(info);
					try {
						handle.offExit(exitHandler);
					} catch {
						// ignore
					}
					for (const detach of detachments) {
						try {
							detach();
						} catch {
							// ignore
						}
					}
					if (messagePortListener && handle.messagePort) {
						try {
							handle.messagePort.close();
						} catch {
							// ignore
						}
					}
				};

				handle.onExit(exitHandler);
				options.onReady?.();

				return {
					waitForExit: () => exitPromise,
					write(data) {
						try {
							handle.stdin?.write(data);
						} catch {
							// ignore
						}
					},
					end() {
						try {
							handle.stdin?.end();
						} catch {
							// ignore
						}
					},
					resize(_cols, _rows) {
						// no-op
					},
					signal(_signal) {
						handle.kill();
					},
					terminate() {
						handle.kill();
					},
					messagePort: handle.messagePort ?? null,
					stdin: handle.stdin ?? null,
					stdout: handle.stdout ?? null,
					stderr: handle.stderr ?? null,
					threadId: handle.threadId ?? null,
					threadName: handle.threadName ?? null,
				};
			})
			.catch((error) => {
				const normalised =
					error instanceof Error ? error : new Error(String(error));
				options.onError?.(normalised);
				throw normalised;
			});
	};
};

ensureNodeSpawnBridge();

const http = await import('../../dist/http.js');
globalThis.coreModules.http = http.default;

// Recycle http module for http2
const http2 = await import('../../dist/http2.js');
globalThis.coreModules.http2 = {
	// For HTTP2 constants
	// ...http2.default,
	constants: http2.default.constants,
	// For actual requests
	...http2.default,
};

const crypto = await import('../../dist/crypto.js');
globalThis.coreModules.crypto = crypto.default;

const https = await import('../../dist/https.js');
globalThis.coreModules.https = https.default;

const tls = await import('../../dist/tls.js');
globalThis.coreModules.tls = tls.default;

const net = await import('../../dist/net.js');
globalThis.coreModules.net = net.default;

const url = await import('../../dist/url.js');
globalThis.coreModules.url = {
	...url.default,
	pathToFileURL: globalThis.internalModules.url.pathToFileURL,
	fileURLToPath: globalThis.internalModules.url.fileURLToPath,
};

const zlib = await import('../../dist/zlib.js');
globalThis.coreModules.zlib = zlib.default;

const dns = await import('../../dist/dns.js');
globalThis.coreModules.dns = dns.default;

const readline = await import('../../dist/readline.js');
globalThis.coreModules.readline = readline.default;

const querystring = await import('../../dist/querystring.js');
globalThis.coreModules.querystring = querystring.default;

const console2 = await import('../../dist/console.js');
globalThis.coreModules.console = console2.default;

const tty = await import('../../dist/tty.js');
globalThis.coreModules.tty = tty.default;

const assert = await import('../../dist/assert.js');
globalThis.coreModules.assert = assert.default;

const assertStrict = await import('../../dist/assert/strict.js');
globalThis.coreModules['assert/strict'] = assertStrict.default;

const timers = await import('../../dist/timers.js');
globalThis.coreModules.timers = timers.default;

const timersPromises = await import('../../dist/timers/promises.js');
globalThis.coreModules['timers/promises'] = timersPromises.default;

const childProcess = await import('../../dist/child_process.js');
globalThis.coreModules.child_process = childProcess.default;

const vm = await import('../../dist/vm.js');
globalThis.coreModules.vm = vm.default;

const v8 = await import('../../dist/v8.js');
globalThis.coreModules.v8 = { ...v8 };
const workerBindingContext = (() => {
	const threadIdValue =
		typeof globalThis.__kernelProcessThreadId === 'number'
			? globalThis.__kernelProcessThreadId
			: 0;
	const threadNameValue =
		typeof globalThis.__kernelProcessThreadName === 'string'
			? globalThis.__kernelProcessThreadName
			: threadIdValue === 0
			? 'MainThread'
			: `worker-${threadIdValue}`;
	const messagePortValue = globalThis.__kernelProcessMessagePort
		? ensureNodeMessagePort(globalThis.__kernelProcessMessagePort)
		: null;
	if (messagePortValue) {
		try {
			messagePortValue.unref();
		} catch {
			// Ignore inability to adjust ref state on bootstrap port.
		}
		globalThis.__kernelProcessMessagePort = messagePortValue;
	}
	return {
		threadId: threadIdValue,
		threadName: threadNameValue,
		isMainThread: threadIdValue === 0,
		messagePort: messagePortValue,
	};
})();

if (typeof globalThis.__kernelWorkerThreadCounter !== 'number') {
	const seed = workerBindingContext.isMainThread
		? 1
		: (workerBindingContext.threadId ?? 0) + 1;
	globalThis.__kernelWorkerThreadCounter = seed;
}

const allocateWorkerThreadId = () => {
	const key = '__kernelWorkerThreadCounter';
	const current =
		typeof globalThis[key] === 'number'
			? (globalThis[key])
			: 1;
	globalThis[key] = current + 1;
	return current;
};

const workerDataFromEnv = () => {
	if (workerBindingContext.isMainThread) {
		return undefined;
	}
	try {
		const raw = process?.env?.__KERNEL_WORKER_DATA;
		if (raw) {
			delete process.env.__KERNEL_WORKER_DATA;
			return JSON.parse(raw);
		}
	} catch {
		// Ignore workerData parsing issues.
	}
	return undefined;
};

const createWorkerThreadsPolyfill = () => {
	let workerIdCounter =
		workerBindingContext.threadId && workerBindingContext.threadId > 0
			? workerBindingContext.threadId + 1
			: 1;

	const isMainThread = workerBindingContext.isMainThread;

	const kNativePort = Symbol('nodeWorkerNativePort');
	const portWrapperCache = new WeakMap();

	const wrapMessagePortForUser = (port) => {
		if (!port) {
			return null;
		}
		const nativePort = port[kNativePort] ?? port;
		if (portWrapperCache.has(nativePort)) {
			return portWrapperCache.get(nativePort);
		}
		const emitter = new events.default.EventEmitter();
		const pendingEvents = [];
		const listenerCountFor = (eventName) => {
			if (
				emitter &&
				typeof emitter.listenerCount === 'function'
			) {
				return emitter.listenerCount(eventName);
			}
			if (
				events?.default?.EventEmitter &&
				typeof events.default.EventEmitter.listenerCount === 'function'
			) {
				return events.default.EventEmitter.listenerCount(
					emitter,
					eventName
				);
			}
			return 0;
		};
		const queueOrEmit = (type, value) => {
			if (type !== 'message' && type !== 'messageerror') {
				emitter.emit(type, value);
				return;
			}
			if (listenerCountFor(type) > 0) {
				emitter.emit(type, value);
				return;
			}
			pendingEvents.push({ type, value });
		};
		const flushPending = (type) => {
			if (!pendingEvents.length) {
				return;
			}
			if (listenerCountFor(type) === 0) {
				return;
			}
			const remaining = [];
			for (const entry of pendingEvents) {
				if (entry.type === type) {
					emitter.emit(type, entry.value);
				} else {
					remaining.push(entry);
				}
			}
			pendingEvents.length = 0;
			if (remaining.length) {
				pendingEvents.push(...remaining);
			}
		};
		const wrapAddListener = (original) =>
			function (type, listener) {
				const result = original.call(this, type, listener);
				if (type === 'message' || type === 'messageerror') {
					flushPending(type);
				}
				return result;
			};
		if (typeof emitter.on === 'function') {
			const originalOn = emitter.on;
			emitter.on = wrapAddListener(originalOn);
			emitter.addListener = emitter.on;
		}
		if (typeof emitter.once === 'function') {
			const originalOnce = emitter.once;
			emitter.once = wrapAddListener(originalOnce);
		}
		if (typeof emitter.prependListener === 'function') {
			const originalPrepend = emitter.prependListener;
			emitter.prependListener = wrapAddListener(originalPrepend);
		}
		if (typeof emitter.prependOnceListener === 'function') {
			const originalPrependOnce = emitter.prependOnceListener;
			emitter.prependOnceListener = wrapAddListener(originalPrependOnce);
		}
		const wrapIncoming = (value) => {
			if (!value || typeof value !== 'object') {
				return value;
			}
			if (value && value[kNativePort]) {
				return wrapMessagePortForUser(value[kNativePort]);
			}
			if (typeof MessagePort !== 'undefined' && value instanceof MessagePort) {
				return wrapMessagePortForUser(value);
			}
			if (Array.isArray(value)) {
				return value.map(wrapIncoming);
			}
			const result = { ...value };
			for (const key of Object.keys(result)) {
				result[key] = wrapIncoming(result[key]);
			}
			return result;
		};

		const unwrapOutgoing = (value) => {
			if (!value || typeof value !== 'object') {
				return value;
			}
			if (value && value[kNativePort]) {
				return value[kNativePort];
			}
			if (typeof MessagePort !== 'undefined' && value instanceof MessagePort) {
				return value;
			}
			if (Array.isArray(value)) {
				return value.map(unwrapOutgoing);
			}
			const result = { ...value };
			for (const key of Object.keys(result)) {
				result[key] = unwrapOutgoing(result[key]);
			}
			return result;
		};
		const extractMessagePayload = (event) => {
			if (event && typeof event === 'object' && 'data' in event) {
				// DOM MessageEvent-style payload
				return event.data;
			}
			// Node-style EventEmitter payload passes the value directly
			return event;
		};
		const handleMessage = (event) =>
			queueOrEmit('message', wrapIncoming(extractMessagePayload(event)));
		const handleMessageError = (event) =>
			queueOrEmit('messageerror', extractMessagePayload(event));
		nativePort.addEventListener?.('message', handleMessage);
		nativePort.addEventListener?.('messageerror', handleMessageError);
		nativePort.start?.();
		emitter.postMessage = (value, transferList) => {
			const nativeTransfers = Array.isArray(transferList)
				? transferList.map((item) =>
					item && item[kNativePort] ? item[kNativePort] : item)
				: undefined;
			nativePort.postMessage(unwrapOutgoing(value), nativeTransfers);
		};
		emitter.close = () => {
			try {
				nativePort.removeEventListener?.('message', handleMessage);
				nativePort.removeEventListener?.('messageerror', handleMessageError);
			} catch {
				// ignore
			}
			try {
				nativePort.close?.();
			} catch {
				// ignore
			}
			pendingEvents.length = 0;
			emitter.emit('close');
		};
		emitter.start = () => nativePort.start?.();
		emitter.ref = () => emitter;
		emitter.unref = () => emitter;
		emitter[kNativePort] = nativePort;
		portWrapperCache.set(nativePort, emitter);
		return emitter;
	};

	const parentPort = isMainThread
		? null
		: wrapMessagePortForUser(workerBindingContext.messagePort);

	const workerData = workerDataFromEnv();
	const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');

	class Worker extends events.default.EventEmitter {
		#port;
		#handle = null;
		#readyPromise;
		#closed = false;
		threadId;
		threadName;

		constructor(filename, options = {}) {
			super();
			if (typeof filename !== 'string' || filename.length === 0) {
				throw new Error('Worker filename must be a non-empty string');
			}

			if (
				!globalThis.processController ||
				typeof globalThis.processController.spawnNodeProcess !== 'function'
			) {
				throw new Error('worker_threads is not available in this environment');
			}

			const resolvedName =
				typeof options.name === 'string' && options.name.length
					? options.name
					: `worker-${workerIdCounter++}`;

			const { port1, port2 } = new MessageChannel();
			this.#port = wrapMessagePortForUser(port1);
			this.#port.on('message', (value) => this.emit('message', value));
			this.#port.on('messageerror', (value) =>
				this.emit('messageerror', value)
			);
			this.#port.on('close', () => {
				if (this.#closed) {
					return;
				}
				this.#closed = true;
				this.emit('exit', 0);
			});

			const spawnEnv = {
				...(options.env ?? {}),
			};
			if ('workerData' in options) {
				try {
					spawnEnv.__KERNEL_WORKER_DATA = JSON.stringify(options.workerData);
				} catch {
					// Ignore serialization errors.
				}
			}

			const cwd =
				typeof options.cwd === 'string' && options.cwd.length
					? options.cwd
					: typeof globalThis.processController.cwd === 'function'
					? globalThis.processController.cwd()
					: '/';

			const stdio = {
				stdin: options.stdin ? 'pipe' : 'ignore',
				stdout:
					options.stdout === false
						? 'ignore'
						: options.stdout === 'inherit'
						? 'inherit'
						: 'pipe',
				stderr:
					options.stderr === false
						? 'ignore'
						: options.stderr === 'inherit'
						? 'inherit'
						: 'pipe',
			};

			this.threadId = allocateWorkerThreadId();
			this.threadName = resolvedName;

			this.#readyPromise = globalThis.processController
				.spawnNodeProcess({
					argv: ['node', filename],
					env: spawnEnv,
					cwd,
					name: resolvedName,
					debug: Boolean(options.debug),
					stdio,
					messagePort: port2,
					workerThreadId: this.threadId,
					workerThreadName: this.threadName,
					onExit: ({ code }) => {
						if (this.#closed) {
							return;
						}
						this.#closed = true;
						this.emit('exit', typeof code === 'number' ? code : 0);
					},
					onError: (error) => {
						queueMicrotask(() => this.emit('error', error));
					},
					onReady: () => {
						queueMicrotask(() => this.emit('online'));
					},
				})
				.then((handle) => {
					this.#handle = handle;
					this.stdin = handle.stdin ?? null;
					this.stdout = handle.stdout ?? null;
					this.stderr = handle.stderr ?? null;
					return handle;
				})
				.catch((error) => {
					queueMicrotask(() => this.emit('error', error));
					throw error;
				});
		}

		postMessage(value, transferList) {
			this.#port.postMessage(value, transferList);
		}

		async terminate() {
			if (this.#closed) {
				return 0;
			}
			this.#closed = true;
			const exitPromise = new Promise((resolve) => {
				this.once('exit', (code) => {
					resolve(typeof code === 'number' ? code : 0);
				});
			});
			try {
				const handle = await this.#readyPromise;
				handle?.terminate?.();
			} catch {
				// Ignore termination errors.
			}
			return exitPromise;
		}

		ref() {
			this.#port.ref?.();
			return this;
		}

		unref() {
			this.#port.unref?.();
			return this;
		}
	}

	class NodeMessageChannel {
		constructor() {
			const native = new MessageChannel();
			this.port1 = wrapMessagePortForUser(native.port1);
			this.port2 = wrapMessagePortForUser(native.port2);
		}
	}

	function MessagePortCtor() {
		throw new Error('MessagePort cannot be constructed directly');
	}
	MessagePortCtor.prototype = events.default.EventEmitter.prototype;
	Object.defineProperty(MessagePortCtor, 'prototype', { writable: false });

	return {
		Worker,
		isMainThread,
		parentPort,
		workerData,
		threadId: workerBindingContext.threadId ?? 0,
		SHARE_ENV,
		MessageChannel: NodeMessageChannel,
		MessagePort: MessagePortCtor,
		BroadcastChannel: globalThis.BroadcastChannel,
		receiveMessageOnPort: messagingBinding.receiveMessageOnPort,
		moveMessagePortToContext: messagingBinding.moveMessagePortToContext,
	};
};

const workerThreadsPolyfill = createWorkerThreadsPolyfill();
workerThreadsPolyfill.default = workerThreadsPolyfill;
globalThis.coreModules.worker_threads = workerThreadsPolyfill;
globalThis.coreModules['node:worker_threads'] = workerThreadsPolyfill;
globalThis.internalModules.worker_threads = workerThreadsPolyfill;
globalThis.internalModules.worker = {
	ownsProcessState: false,
	isMainThread: workerBindingContext.isMainThread,
	isInternalThread: false,
	resourceLimits: {},
	threadId: workerBindingContext.threadId ?? 0,
	threadName: workerBindingContext.threadName ?? 'WorkerThread',
	createMainThreadPort() {
		const { port1, port2 } = new MessageChannel();
		try {
			port1.start?.();
		} catch {
			// ignore
		}
		return port2;
	},
	destroyMainThreadPort(port) {
		try {
			port?.close?.();
		} catch {
			// ignore
		}
	},
	getEnvMessagePort() {
		if (!workerBindingContext.messagePort) {
			throw new Error('Worker environment message port is not available');
		}
		return workerBindingContext.messagePort;
	},
	Worker: workerThreadsPolyfill.Worker,
};

const Module = await import('./module.js');
globalThis.coreModules.module = {
	...Module,
	runMain: () => Module.Module.runMain(),
};

// realm.BuiltinModule
for (const key in globalThis.coreModules) {
	realm.default.BuiltinModule.allowRequireByUsers(key);
	realm.default.BuiltinModule.map.set(key, {
		exports: globalThis.coreModules[key],
		filename: key,
		id: key,
		loaded: true,
		loading: false,
		compileForPublicLoader() {},
	});
}

globalThis.internalModules.natives = Object.keys(globalThis.internalModules);

// const ModuleCJSLoader = await import("../../dist/internal/modules/cjs/loader.js");
// console.log({ ModuleCJSLoader })
// globalThis.coreModules.module.Module = ModuleCJSLoader.Module;
// console.log({ModuleCJSLoader})

// @TODO:
// const resolveModule = await import("../../dist/internal/resolve.js");
// console.log({ resolveModule })

function normalizeArgv(argv) {
	if (!Array.isArray(argv)) {
		return null;
	}
	return argv.map((value) => {
		if (value == null) {
			return '';
		}
		return String(value);
	});
}

function ensureEntryFromArgv(argv) {
	if (!Array.isArray(argv)) {
		return '';
	}
	const candidate = argv.length > 1 ? argv[1] : argv[0];
	return typeof candidate === 'string' && candidate.length ? candidate : '';
}

export function runMain() {
	globalThis.coreModules.module.initializeCJS();
	return globalThis.coreModules.module.Module.runMain();
}

globalThis.setImmediate = setTimeout;

globalThis.coreModules.fs.realpath.native = globalThis.coreModules.fs.realpath; //globalThis.internalModules.fs.realpathSync;
globalThis.coreModules.fs.lutimes = function (
	path,
	atime,
	mtime,
	kUsePromises
) {
	return maybePromiseFromSync(() => {
		// Update timestamps on symlink itself if symlink; otherwise behave like utimes
		const { node } = globalFs.walk(path);
		if (!node) {
			const error = new Error(
				`ENOENT: no such file or directory, lutimes '${path}'`
			);
			error.code = 'ENOENT';
			throw error;
		}
		if (node.type !== 'symlink') {
			// If not a symlink, match Node: apply to target file
			return globalFs.utimesSync(path, atime, mtime);
		}
		// For symlink, store times on the link node
		node.atime = atime;
		node.mtime = mtime;
		node.ctime = Date.now();
	}, kUsePromises);
};

const timeouts = new Map();
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

globalThis.setTimeout = (callback, after, ...args) => {
	// Start the timeout immediately
	const timeoutId = originalSetTimeout(callback, after, ...args);

	// Create a timeout object that mimics Node.js behavior
	const timeoutObj = {
		_id: timeoutId,
		_unrefd: false,
		unref() {
			this._unrefd = true;
			return this;
		},
		ref() {
			this._unrefd = false;
			return this;
		},
		hasRef() {
			return !this._unrefd;
		},
	};

	// Store the mapping for clearTimeout
	timeouts.set(timeoutObj, timeoutId);

	return timeoutObj;
};

globalThis.clearTimeout = (timeout) => {
	if (timeout && typeof timeout === 'object' && timeouts.has(timeout)) {
		// Handle our custom timeout objects
		const timeoutId = timeouts.get(timeout);
		timeouts.delete(timeout);
		return originalClearTimeout(timeoutId);
	} else {
		// Handle regular timeout IDs (for compatibility)
		return originalClearTimeout(timeout);
	}
};

const intervals = new Map();
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

globalThis.setInterval = (callback, interval, ...args) => {
	// Start the interval immediately
	const intervalId = originalSetInterval(callback, interval, ...args);

	// Create an interval object that mimics Node.js behavior
	const intervalObj = {
		_id: intervalId,
		_unrefd: false,
		unref() {
			this._unrefd = true;
			return this;
		},
		ref() {
			this._unrefd = false;
			return this;
		},
		hasRef() {
			return !this._unrefd;
		},
	};

	// Store the mapping for clearInterval
	intervals.set(intervalObj, intervalId);

	return intervalObj;
};

globalThis.clearInterval = (interval) => {
	if (interval && typeof interval === 'object' && intervals.has(interval)) {
		// Handle our custom interval objects
		const intervalId = intervals.get(interval);
		intervals.delete(interval);
		return originalClearInterval(intervalId);
	} else {
		// Handle regular interval IDs (for compatibility)
		return originalClearInterval(interval);
	}
};

// Instantiate the process global
const streamModule = globalThis.coreModules?.stream;
if (!streamModule) {
	throw new Error('stream module is not available');
}
// @TODO: A better way of connecting a TTY stream
const { Writable, Readable } = streamModule;

const stdin = new (class Stdin extends Readable {
	#detachData = null;
	#detachEnd = null;
	#detachClose = null;
	constructor() {
		super({ objectMode: true });
		this.fd = 0;
		const source = processController.stdin;
		if (!source || typeof source.on !== 'function') {
			queueMicrotask(() => this.push(null));
			return;
		}
		this.#detachData = source.on('data', (chunk) => {
			this.push(chunk);
		});
		this.#detachEnd = source.on('end', () => {
			this.push(null);
		});
		this.#detachClose = source.on('close', () => {
			this.destroy();
		});
	}
	_read(_size) {
		// Data is pushed via processController stdin events.
	}
	_destroy(err, callback) {
		try {
			this.#detachData?.();
			this.#detachEnd?.();
			this.#detachClose?.();
		} catch {
			// ignore
		}
		callback(err);
	}
})();

const stdout = new (class Stdout extends Writable {
	constructor() {
		super({ objectMode: true });
		this.fd = 1;
	}
	_write(chunk, encoding, callback) {
		try {
			processController.stdout.write(chunk);
			callback();
		} catch (error) {
			console.error('Error writing to stdout:', error);
			callback(error);
		}
	}
})();

stdout.on('finish', () => {
	processController.stdout.end();
});

const stderr = new (class Stderr extends Writable {
	constructor() {
		super({ objectMode: true });
		this.fd = 2;
	}
	_write(chunk, encoding, callback) {
		try {
			processController.stderr.write(chunk);
			callback();
		} catch (error) {
			console.error('Error writing to stderr:', error);
			callback(error);
		}
	}
})();

stderr.on('finish', () => {
	processController.stderr.end();
});

globalThis.process.initStreams({
	stdin,
	stdout,
	stderr,
});
globalThis.process.stdin.setEncoding('utf-8');
globalThis.process.stdin.resume();

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	// Check if the URL is cross-origin and needs proxying
	let url =
		typeof input === 'string'
			? input
			: input instanceof URL
			? input.href
			: input.url;

	if (url && typeof url === 'string') {
		try {
			const parsedUrl = new URL(url, globalThis.location?.href);
			const currentOrigin = globalThis.location?.origin;

			// If it's a cross-origin request, proxy it through our CORS proxy
			if (currentOrigin && parsedUrl.origin !== currentOrigin) {
				const proxyUrl = `/proxy/?url=${encodeURIComponent(url)}`;

				if (typeof input === 'string') {
					input = proxyUrl;
				} else if (input instanceof URL) {
					input = new URL(proxyUrl);
				} else if (input && typeof input === 'object') {
					input = { ...input, url: proxyUrl };
				}
			}
		} catch (error) {
			// If URL parsing fails, proceed with original request
			console.warn('Failed to parse URL for proxy check:', error);
		}
	}

	return originalFetch(input, init);
};
