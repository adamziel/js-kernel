import { MessagePortWritableStream, type KernelStdioChunk } from '../../ipc/message-port.ts';
import {
	decodeSerializedResponse,
	deserializeFsResponse,
	type SerializedFsResponse,
} from '../../fs/serialization.ts';
import {
	SYNC_HEADER_BYTES,
	SYNC_HEADER_INT_COUNT,
	SYNC_LENGTH_INDEX,
	SYNC_STATUS_INDEX,
	SYNC_STATUS_OVERFLOW,
	SYNC_STATUS_PENDING,
	SYNC_STATUS_READY,
	SYNC_TOTAL_BYTES,
} from '../../ipc/sync/shared-buffer.ts';

type AsyncResolver = {
	resolve(value: unknown): void;
	reject(reason: unknown): void;
};

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

export const createKernelFsClient = (
	fsPort: MessagePort,
	stdio?: StdioStreams
): KernelFsClient => {
	const pumpWorker = new Worker(
		new URL('../../ipc/sync/pump-worker.ts', import.meta.url),
		{ type: 'module', name: 'sync-pump(fs)' }
	);

	let disposed = false;
	let nextRequestId = 1;
	const pendingAsync = new Map<number, AsyncResolver>();
	let warnedEmptyStdin = false;

	const handlePumpMessage = (event: MessageEvent) => {
		const payload = event.data;
		if (!payload || typeof payload !== 'object') {
			return;
		}
		if (payload.type !== 'asyncResponse') {
			return;
		}

		const requestId = payload.requestId;
		const response: SerializedFsResponse | undefined = payload.response;

		if (typeof requestId !== 'number') {
			return;
		}

		const resolver = pendingAsync.get(requestId);
		if (!resolver) {
			return;
		}
		pendingAsync.delete(requestId);

		if (!response) {
			resolver.reject(new Error('Missing filesystem response'));
			return;
		}
		const materialized = deserializeFsResponse(response);
		if (materialized.ok) {
			resolver.resolve(materialized.value);
		} else {
			resolver.reject(materialized.error);
		}
	};

	pumpWorker.addEventListener('message', handlePumpMessage);
	pumpWorker.postMessage(
		{
			type: 'init',
			channel: 'fs',
			port: fsPort,
		},
		[fsPort]
	);

const stdinRemainders = new WeakMap<StdioStreams['stdin'], Uint8Array>();
const textEncoder =
	typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

	const toReadResult = (bytes: Uint8Array, lengthOverride?: number) => {
		const view =
			typeof lengthOverride === 'number'
				? bytes.subarray(0, lengthOverride)
				: bytes;
		const primitive = () =>
			typeof lengthOverride === 'number'
				? lengthOverride
				: view.byteLength ?? 0;
		(view as any).valueOf = primitive;
		(view as any).bytesRead = primitive();
		if (typeof Symbol === 'function' && Symbol.toPrimitive) {
			(view as any)[Symbol.toPrimitive] = primitive;
		}
		return view;
	};

	const toUint8Array = (chunk: unknown): Uint8Array => {
		if (chunk instanceof Uint8Array) {
			return chunk;
		}
		if (
			typeof Buffer !== 'undefined' &&
			typeof Buffer.from === 'function' &&
			Buffer.isBuffer?.(chunk)
		) {
			return Uint8Array.from(chunk);
		}
		if (typeof chunk === 'string') {
			return textEncoder ? textEncoder.encode(chunk) : Uint8Array.from([]);
		}
		if (
			typeof ArrayBuffer !== 'undefined' &&
			chunk instanceof ArrayBuffer
		) {
			return new Uint8Array(chunk);
		}
		return new Uint8Array(0);
	};

	const toWritableBufferView = (buffer: unknown): Uint8Array | null => {
		if (
			typeof Buffer !== 'undefined' &&
			typeof Buffer.isBuffer === 'function' &&
			Buffer.isBuffer(buffer)
		) {
			return buffer as Uint8Array;
		}
		if (buffer instanceof Uint8Array) {
			return buffer;
		}
		if (buffer instanceof ArrayBuffer) {
			return new Uint8Array(buffer);
		}
		if (ArrayBuffer.isView(buffer)) {
			const view = buffer as ArrayBufferView;
			return new Uint8Array(
				view.buffer,
				view.byteOffset,
				view.byteLength
			);
		}
		return null;
	};

	const consumeStdin = (
		streams: StdioStreams,
		length: number
	): Uint8Array | null => {
		const stdinStream = streams.stdin;
		if (!stdinStream) {
			return null;
		}

		let buffered = stdinRemainders.get(stdinStream);
		if (!buffered || buffered.byteLength === 0) {
			stdinRemainders.delete(stdinStream);
			const data = stdinStream.read();
			if (!data) {
				return new Uint8Array(0);
			}
			buffered = toUint8Array(data);
		} else {
			stdinRemainders.delete(stdinStream);
		}

		if (length === 0) {
			if (buffered && buffered.byteLength > 0) {
				stdinRemainders.set(stdinStream, buffered);
			}
			return new Uint8Array(0);
		}

	if (length > 0 && buffered.byteLength > length) {
		const head = buffered.slice(0, length);
		stdinRemainders.set(stdinStream, buffered.slice(length));
		return head;
	}
	return buffered;
	};

	// Async version - waits for stdin data to become available
	const consumeStdinAsync = async (
		streams: StdioStreams,
		length: number
	): Promise<Uint8Array> => {
		const stdinStream = streams.stdin;
		if (!stdinStream) {
			return new Uint8Array(0);
		}

		// Try to read immediately
		const immediate = consumeStdin(streams, length);
		if (immediate && immediate.byteLength > 0) {
			return immediate;
		}

		// If stream is ended/closed, return empty
		if (stdinStream.isEnded() || stdinStream.isClosed()) {
			return new Uint8Array(0);
		}

		// Wait for data to become available
		return new Promise<Uint8Array>((resolve) => {
			const pollInterval = setInterval(() => {
				// Check if stream ended/closed
				if (stdinStream.isEnded() || stdinStream.isClosed()) {
					clearInterval(pollInterval);
					resolve(new Uint8Array(0));
					return;
				}

				// Try to read data
				const bytes = consumeStdin(streams, length);
				if (bytes && bytes.byteLength > 0) {
					clearInterval(pollInterval);
					resolve(bytes);
				}
			}, 10); // Poll every 10ms
		});
	};

	const tryHandleStdioAsync = (
		method: string,
		args: unknown[],
		streams: StdioStreams
	): Promise<unknown> | null => {
		const fd = typeof args[0] === 'number' ? args[0] : null;
		if (fd === null || (fd !== 0 && fd !== 1 && fd !== 2)) {
			return null;
		}

		// Handle write operations to stdout (1) or stderr (2)
		// writeSync(fd, data, offsetOrPos, lengthOrEnc, position)
		if (
			(method === 'write' || method === 'writeSync') &&
			(fd === 1 || fd === 2)
		) {
			return Promise.resolve().then(() => {
				const stream = fd === 1 ? streams.stdout : streams.stderr;
				const data = args[1];
				const offsetOrPos = args[2];
				const lengthOrEnc = args[3];
				const position = args[4];

				const chunk = extractWriteData(
					data,
					offsetOrPos,
					lengthOrEnc,
					position
				);
				stream.write(chunk);
				return chunk instanceof Uint8Array
					? chunk.byteLength
					: chunk.length;
			});
		}

		// Handle async read operations from stdin (0)
		// read(fd, length, position) - truly asynchronous, waits for data
		if (method === 'read' && fd === 0) {
			const length = typeof args[1] === 'number' ? args[1] : 0;
			return consumeStdinAsync(streams, length).then((bytes) =>
				toReadResult(bytes, Math.min(length, bytes.byteLength))
			);
		}

		return null;
	};

	const tryHandleStdioSync = (
		method: string,
		args: unknown[],
		streams: StdioStreams
	): unknown | null => {
		const fd = typeof args[0] === 'number' ? args[0] : null;
		if (fd === null || (fd !== 0 && fd !== 1 && fd !== 2)) {
			return null;
		}

		// Handle write operations to stdout (1) or stderr (2)
		// writeSync(fd, data, offsetOrPos, lengthOrEnc, position)
		if (
			(method === 'writeSync' || method === 'write') &&
			(fd === 1 || fd === 2)
		) {
			const stream = fd === 1 ? streams.stdout : streams.stderr;
			const data = args[1];
			const offsetOrPos = args[2];
			const lengthOrEnc = args[3];
			const position = args[4];

			const chunk = extractWriteData(
				data,
				offsetOrPos,
				lengthOrEnc,
				position
			);
			stream.write(chunk);
			return chunk instanceof Uint8Array
				? chunk.byteLength
				: chunk.length;
		}

		// Handle synchronous read operations from stdin (0)
		// readSync(fd, length, position) - returns immediately with available data
		if (method === 'readSync' && fd === 0) {
			const nodeBuffer = toWritableBufferView(args[1]);
			if (nodeBuffer) {
				const offset =
					typeof args[2] === 'number' && Number.isFinite(args[2])
						? Math.max(0, Math.floor(args[2]))
						: 0;
				const requestedLengthRaw =
					typeof args[3] === 'number' && Number.isFinite(args[3])
						? Math.floor(args[3])
						: null;
				const available = Math.max(
					0,
					nodeBuffer.byteLength - offset
				);
				const requestedLength =
					requestedLengthRaw === null
						? available
						: Math.max(0, Math.min(available, requestedLengthRaw));
				if (available <= 0 || requestedLength <= 0) {
					return toReadResult(new Uint8Array(0), 0);
				}
				const bytes = consumeStdin(streams, requestedLength);
				if (!bytes) {
					if (!warnedEmptyStdin) {
						warnedEmptyStdin = true;
						console.error(
							'[kernel-fs] readSync(fd=0) returned no data; stdin has no buffered data'
						);
					}
					return toReadResult(new Uint8Array(0), 0);
				}
				const copyLength = Math.min(
					requestedLength,
					bytes.byteLength
				);
				if (copyLength > 0) {
					nodeBuffer.set(
						bytes.subarray(0, copyLength),
						offset
					);
				}
				return toReadResult(bytes, copyLength);
			}

			const length = typeof args[1] === 'number' ? args[1] : 0;
			const bytes = consumeStdin(streams, length);
			if (!bytes) {
				if (!warnedEmptyStdin) {
					warnedEmptyStdin = true;
					console.error(
						'[kernel-fs] readSync(fd=0) returned no data; stdin has no buffered data'
					);
				}
				return toReadResult(new Uint8Array(0), 0);
			}
			return toReadResult(bytes);
		}

		return null;
	};

const requestAsync = (
	method: string,
	args: unknown[]
): Promise<unknown> => {
		if (disposed) {
			return Promise.reject(
				new Error('Filesystem bridge has been disposed')
			);
		}

		// Intercept stdio operations
		if (stdio) {
			const stdioResult = tryHandleStdioAsync(method, args, stdio);
			if (stdioResult !== null) {
				return stdioResult;
			}
		}

		const requestId = nextRequestId++;
		return new Promise<unknown>((resolve, reject) => {
			pendingAsync.set(requestId, { resolve, reject });
			try {
				pumpWorker.postMessage({
					type: 'asyncRequest',
					requestId,
					method,
					args,
				});
			} catch (error) {
				pendingAsync.delete(requestId);
				reject(
					error instanceof Error
						? error
						: new Error(String(error ?? 'Async request failed'))
				);
			}
		});
	};

	const requestSync = (method: string, args: unknown[]): unknown => {
		if (disposed) {
			throw new Error('Filesystem bridge has been disposed');
		}

		// Intercept stdio operations
		if (stdio) {
			const stdioResult = tryHandleStdioSync(method, args, stdio);
			if (stdioResult !== null) {
				return stdioResult;
			}
		}

		const normalizedArgs = Array.isArray(args) ? [...args] : [];
		let bufferBytes = SYNC_TOTAL_BYTES;
		const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

		for (let attempt = 0; attempt < 6; attempt += 1) {
			const buffer = new SharedArrayBuffer(bufferBytes);
			const header = new Int32Array(buffer, 0, SYNC_HEADER_INT_COUNT);
			const requestId = nextRequestId++;

			try {
				pumpWorker.postMessage({
					type: 'syncRequest',
					requestId,
					method,
					args: normalizedArgs,
					buffer,
				});
			} catch (error) {
				throw error instanceof Error
					? error
					: new Error(String(error ?? 'Sync request failed'));
			}

			waitForSyncResult(header);

			const status = Atomics.load(header, SYNC_STATUS_INDEX);
			if (status === SYNC_STATUS_OVERFLOW) {
				const required = Atomics.load(header, SYNC_LENGTH_INDEX);
				const minimum =
					required > 0
						? SYNC_HEADER_BYTES + required
						: bufferBytes * 2;
				const nextSize = Math.max(bufferBytes * 2, minimum + 1024);
				if (nextSize > MAX_BUFFER_BYTES) {
					throw new Error(
						`Synchronous filesystem response exceeded ${MAX_BUFFER_BYTES} bytes`
					);
				}
				bufferBytes = Math.min(nextSize, MAX_BUFFER_BYTES);
				continue;
			}
			if (status !== SYNC_STATUS_READY) {
				throw new Error(
					`Unexpected synchronous filesystem status: ${status}`
				);
			}

			const length = Atomics.load(header, SYNC_LENGTH_INDEX);
			if (length <= 0) {
				throw new Error('Empty filesystem response payload');
			}
			const payload = new Uint8Array(buffer, SYNC_HEADER_BYTES, length);
			const response = decodeSerializedResponse(payload.slice());
			const materialized = deserializeFsResponse(response);
			if (materialized.ok) {
				return materialized.value;
			}
			throw materialized.error;
		}

		throw new Error(
			'Synchronous filesystem response exceeded retry budget'
		);
	};

	const asyncProxy = createMethodProxy(
		resolveKernelMethodName,
		(method, args) => requestAsync(method, args)
	);
	(asyncProxy as any).promises = asyncProxy;
	const syncProxy = createMethodProxy(
		resolveKernelMethodName,
		(method, args) => requestSync(method, args)
	);

	const dispose = () => {
		if (disposed) {
			return;
		}
		disposed = true;
		try {
			pumpWorker.postMessage({ type: 'dispose' });
		} catch {
			// ignore errors while disposing
		}
		pumpWorker.removeEventListener('message', handlePumpMessage);
		pumpWorker.terminate();
		for (const { reject } of pendingAsync.values()) {
			reject(new Error('Filesystem bridge disposed'));
		}
		pendingAsync.clear();
	};

	return {
		async: asyncProxy,
		sync: syncProxy,
		dispose,
	};
};

const createMethodProxy = <T>(
	resolveMethod: (method: string) => string | null,
	invoke: (method: string, args: unknown[]) => T
): Record<string, (...args: unknown[]) => T> => {
	const target = {} as Record<string, (...args: unknown[]) => T>;
	return new Proxy(target, {
		get(currentTarget, property, receiver) {
			if (property === 'then') {
				return undefined;
			}
			if (Reflect.has(currentTarget, property)) {
				return Reflect.get(currentTarget, property, receiver);
			}
			if (typeof property !== 'string') {
				return undefined;
			}
			const kernelMethod = resolveMethod(property);
			if (!kernelMethod) {
				return undefined;
			}
			return (...args: unknown[]) => invoke(kernelMethod, args);
		},
	});
};

const resolveKernelMethodName = (method: string): string => {
	if (method.endsWith('Sync') || method.endsWith('Async')) {
		return method;
	}
	return `${method}Sync`;
};

const waitForSyncResult = (header: Int32Array) => {
	let status = Atomics.load(header, SYNC_STATUS_INDEX);
	while (status === SYNC_STATUS_PENDING) {
		Atomics.wait(header, SYNC_STATUS_INDEX, SYNC_STATUS_PENDING);
		status = Atomics.load(header, SYNC_STATUS_INDEX);
	}
};

/**
 * Extract data for writing based on writeSync signature:
 * writeSync(fd, data, offsetOrPos, lengthOrEnc, position)
 *
 * If data is a string:
 *   - offsetOrPos is the position (ignored for stdio)
 *   - lengthOrEnc is the encoding
 *
 * If data is a buffer:
 *   - offsetOrPos is the offset into the buffer
 *   - lengthOrEnc is the length to write
 *   - position is the file position (ignored for stdio)
 */
const extractWriteData = (
	data: unknown,
	offsetOrPos: unknown,
	lengthOrEnc: unknown,
	position: unknown
): string | Uint8Array => {
	if (typeof data === 'string') {
		// For string data, offsetOrPos is position (ignored), lengthOrEnc is encoding
		return data;
	}

	// For buffer data, extract the relevant portion
	const offset = typeof offsetOrPos === 'number' ? offsetOrPos : 0;

	if (data instanceof Uint8Array) {
		const length =
			typeof lengthOrEnc === 'number'
				? lengthOrEnc
				: data.byteLength - offset;
		return data.slice(offset, offset + length);
	}

	if (data instanceof ArrayBuffer) {
		const view = new Uint8Array(data);
		const length =
			typeof lengthOrEnc === 'number'
				? lengthOrEnc
				: view.byteLength - offset;
		return view.slice(offset, offset + length);
	}

	if (ArrayBuffer.isView(data)) {
		const view = data as ArrayBufferView;
		const bytes = new Uint8Array(
			view.buffer,
			view.byteOffset,
			view.byteLength
		);
		const length =
			typeof lengthOrEnc === 'number'
				? lengthOrEnc
				: bytes.byteLength - offset;
		return bytes.slice(offset, offset + length);
	}

	// Fallback: convert to string
	return String(data);
};
