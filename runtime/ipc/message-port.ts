export type KernelStdioChunk = string | Uint8Array;

type Listener<Arg> = (input: Arg) => void;

class BasicEventEmitter<Events extends Record<string, unknown>> {
	private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

	on<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		if (!this.listeners[event]) {
			this.listeners[event] = new Set();
		}
		this.listeners[event]!.add(listener);
		return () => this.off(event, listener);
	}

	off<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		const listeners = this.listeners[event];
		if (!listeners) return;
		listeners.delete(listener);
		if (listeners.size === 0) {
			delete this.listeners[event];
		}
	}

	once<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		const wrapper: Listener<Events[K]> = (value) => {
			this.off(event, wrapper);
			listener(value);
		};
		return this.on(event, wrapper);
	}

	protected emit<K extends keyof Events>(event: K, value: Events[K]) {
		const listeners = this.listeners[event];
		if (!listeners) return;
		for (const listener of Array.from(listeners)) {
			listener(value);
		}
	}

	protected clearAll() {
		this.listeners = {};
	}
}

const describeChunk = (chunk: KernelStdioChunk): string => {
	if (typeof chunk === 'string') {
		return `string:${chunk.length}`;
	}
	const bufferCtor = (globalThis as any).Buffer;
	if (
		bufferCtor &&
		typeof bufferCtor.isBuffer === 'function' &&
		bufferCtor.isBuffer(chunk)
	) {
		return `buffer:${chunk.length}`;
	}
	if (chunk instanceof Uint8Array) {
		return `uint8:${chunk.byteLength}`;
	}
	if (
		typeof chunk === 'object' &&
		chunk !== null &&
		('byteLength' in chunk || 'length' in chunk)
	) {
		const size =
			(chunk as { byteLength?: number }).byteLength ??
			(chunk as { length?: number }).length ??
			0;
		return `object:${size}`;
	}
	return typeof chunk;
};

interface ReadableEvents {
	data: KernelStdioChunk;
	end: void;
	close: void;
}

interface WritableEvents {
	close: void;
}

export class MessagePortReadableStream extends BasicEventEmitter<ReadableEvents> {
	private buffer: KernelStdioChunk[] = [];
	private readonly waitBuffer: SharedArrayBuffer | null;
	private readonly waitView: Int32Array | null;
	private remoteClosed = false;
	private closed = false;
	private ended = false;
	private static readonly WAIT_TIMEOUT_MS = 5000;
	private readonly debugLabel: string | null;

	constructor(private readonly port: MessagePort, options?: { debugLabel?: string }) {
		super();
		this.debugLabel = options?.debugLabel ?? null;
		if (typeof Atomics === 'object' && typeof Atomics.wait === 'function') {
			this.waitBuffer = new SharedArrayBuffer(4);
			this.waitView = new Int32Array(this.waitBuffer);
		} else {
			this.waitBuffer = null;
			this.waitView = null;
		}

		// Start the port BEFORE adding listener to ensure messages aren't lost
		port.start();
		port.addEventListener('message', this.handleMessage);
	}

	on<K extends keyof ReadableEvents>(
		event: K,
		listener: Listener<ReadableEvents[K]>
	) {
		const unsubscribe = super.on(event, listener);
		if (event === 'data' && this.buffer.length > 0) {
			queueMicrotask(() => {
				for (const chunk of this.buffer) {
					(listener as Listener<KernelStdioChunk>)(chunk);
				}
			});
		}
		if (event === 'end' && (this.ended || this.closed)) {
			queueMicrotask(() => listener(undefined as ReadableEvents[K]));
		}
		if (event === 'close' && this.closed) {
			queueMicrotask(() => listener(undefined as ReadableEvents[K]));
		}
		return unsubscribe;
	}

	read() {
		if (this.buffer.length > 0) {
			return this.buffer.shift()!;
		}
		if (this.ended || this.closed) {
			return null;
		}
		if (this.waitView) {
			while (!this.ended && !this.closed && this.buffer.length === 0) {
				Atomics.store(this.waitView, 0, 0);
				const result = Atomics.wait(
					this.waitView,
					0,
					0,
					MessagePortReadableStream.WAIT_TIMEOUT_MS
				);
				if (result === 'timed-out') {
					continue;
				}
			}
		} else {
			while (!this.ended && !this.closed && this.buffer.length === 0) {
				Atomics.fence();
			}
		}
		return this.buffer.length > 0 ? this.buffer.shift()! : null;
	}

	isClosed() {
		return this.closed;
	}

	isEnded() {
		return this.ended;
	}

	close(fromRemote = false) {
		if (this.closed) return;
		this.closed = true;
		if (!fromRemote && !this.remoteClosed) {
			try {
				this.port.postMessage({ type: 'close' });
			} catch {
				// ignore signalling errors
			}
		}
		this.port.removeEventListener('message', this.handleMessage);
		this.port.close();
		if (this.waitView) {
			Atomics.store(this.waitView, 0, 1);
			Atomics.notify(this.waitView, 0);
		}
		this.emit('close', undefined as unknown as void);
		this.clearAll();
	}

	destroy() {
		this.close();
	}

	private receiveCount = 0;
	private handleMessage = (event: MessageEvent) => {
		const payload = event.data;
		if (!payload || typeof payload !== 'object') {
			return;
		}
		if (payload.type === 'data') {
			this.receiveCount++;
			this.buffer.push(payload.payload);
			this.emit('data', payload.payload);

			if (this.waitView) {
				Atomics.store(this.waitView, 0, 1);
				Atomics.notify(this.waitView, 0);
			}
		} else if (payload.type === 'end') {
			// console.log('[MPR] received end', this.debugLabel);
			this.ended = true;
			this.remoteClosed = true;
			this.emit('end', undefined as unknown as void);
			this.close(true);
		} else if (payload.type === 'close') {
			// console.log('[MPR] received close', this.debugLabel);
			this.remoteClosed = true;
			this.close(true);
		}
	};
}

export class MessagePortWritableStream extends BasicEventEmitter<WritableEvents> {
	private closed = false;
	private remoteClosed = false;
	private readonly logLabel: string | null;
	private readonly queue: Array<
		| { type: 'data'; chunk: KernelStdioChunk }
		| { type: 'signal'; signal: 'end' | 'close'; label?: string }
	> = [];
	private flushing = false;

	constructor(
		private readonly port: MessagePort,
		options?: { debugLabel?: string }
	) {
		super();
		this.logLabel = options?.debugLabel ?? null;
		port.start();
		port.addEventListener('message', this.handleMessage);
	}

	write(chunk: KernelStdioChunk) {
		if (this.closed) {
			return false;
		}
		// Clone the chunk immediately to prevent any detachment issues
		// Explicitly create a new ArrayBuffer to ensure complete independence
		const cloned = typeof chunk === 'string'
			? chunk
			: new Uint8Array(chunk);  // Creates new ArrayBuffer with copy of data
		this.queue.push({ type: 'data', chunk: cloned });
		this.scheduleFlush();
		return true;
	}

	end(chunk?: KernelStdioChunk) {
		if (this.closed) return false;
		if (typeof chunk !== 'undefined') {
			const cloned = typeof chunk === 'string'
				? chunk
				: new Uint8Array(chunk);
			this.queue.push({ type: 'data', chunk: cloned });
		}
		this.queue.push({ type: 'signal', signal: 'end', label: '<EOF>' });
		this.scheduleFlush();
		return true;
	}

	close() {
		if (this.closed) return false;
		this.queue.push({ type: 'signal', signal: 'close', label: '<closed>' });
		this.scheduleFlush();
		return true;
	}

	destroy() {
		if (this.closed) return;
		this.closed = true;
		this.port.removeEventListener('message', this.handleMessage);
		this.port.close();
		this.emit('close', undefined as unknown as void);
		this.clearAll();
		this.queue.length = 0;
	}

	private scheduleFlush() {
		if (this.flushing || this.closed) {
			return;
		}
		this.flushing = true;
		queueMicrotask(() => this.flushQueue());
	}

	private flushQueue() {
		this.flushing = false;
		if (this.closed) {
			this.queue.length = 0;
			return;
		}
		let itemCount = 0;
		while (this.queue.length > 0 && !this.closed) {
			const item = this.queue.shift()!;
			itemCount++;
			if (item.type === 'data') {
				try {
					// Chunk was already cloned in write(), just use it directly
					const payload = item.chunk;
					this.port.postMessage({ type: 'data', payload });
				} catch (err) {
					// Error reporting without stdio pollution - errors thrown will
					// bubble up and appear in browser console without triggering recursion
					this.destroy();
					throw new Error(
						`MessagePort write failed: ${
							err && (err as any).message
						}`
					);
				}
				continue;
			}
			this.logClose(item.label ?? '<closed>');
			try {
				if (!this.remoteClosed) {
					this.port.postMessage({ type: item.signal });
				}
			} finally {
				this.destroy();
			}
		}
		if (!this.closed && this.queue.length > 0) {
			this.scheduleFlush();
		}
	}

	private handleMessage = (event: MessageEvent) => {
		const payload = event.data;
		if (!payload || typeof payload !== 'object') {
			return;
		}
		if (payload.type === 'end' || payload.type === 'close') {
			this.remoteClosed = true;
			this.logClose('<remote closed>');
			this.destroy();
		}
	};

	private logClose(reason: string) {
		if (!this.logLabel) {
			return;
		}
		console.log(`[${this.logLabel}] ${reason}`);
	}
}
export { BasicEventEmitter };
