export type KernelStdioChunk = string | Uint8Array

type Listener<Arg> = (input: Arg) => void

class BasicEventEmitter<Events extends Record<string, unknown>> {
	private listeners: {
		[K in keyof Events]?: Set<Listener<Events[K]>>
	} = {}

	on<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		if (!this.listeners[event]) {
			this.listeners[event] = new Set()
		}
		this.listeners[event]!.add(listener)
		return () => this.off(event, listener)
	}

	once<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		const wrapper: Listener<Events[K]> = (value) => {
			this.off(event, wrapper)
			listener(value)
		}
		return this.on(event, wrapper)
	}

	off<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		const listeners = this.listeners[event]
		if (!listeners) return
		listeners.delete(listener)
		if (listeners.size === 0) {
			delete this.listeners[event]
		}
	}

	protected emit<K extends keyof Events>(event: K, value: Events[K]) {
		const listeners = this.listeners[event]
		if (!listeners) return
		for (const listener of Array.from(listeners)) {
			listener(value)
		}
	}

	protected clearAll() {
		this.listeners = {}
	}
}

interface ReadableEvents extends Record<string, unknown> {
	data: KernelStdioChunk
	end: void
	close: void
}

interface WritableEvents extends Record<string, unknown> {
	close: void
}

export class MessagePortReadableStream extends BasicEventEmitter<ReadableEvents> {
	private buffer: KernelStdioChunk[] = []
	private readonly waitBuffer: SharedArrayBuffer | null
	private readonly waitView: Int32Array | null
	private remoteClosed = false
	private static readonly WAIT_TIMEOUT_MS = 5000
	private readonly handleMessage = (event: MessageEvent) => {
		const payload = event.data
		if (!payload || typeof payload !== 'object') {
			return
		}
		if (payload.type === 'data') {
			this.buffer.push(payload.payload)
			this.emit('data', payload.payload)
			if (this.waitView) {
				Atomics.store(this.waitView, 0, 1)
				Atomics.notify(this.waitView, 0)
			}
		} else if (payload.type === 'end') {
			this.ended = true
			this.remoteClosed = true
			this.emit('end', undefined as unknown as void)
			this.close(true)
		} else if (payload.type === 'close') {
			this.remoteClosed = true
			this.close(true)
		}
}

	// Override on() to replay buffered data for 'data' events
	on<K extends keyof ReadableEvents>(event: K, listener: Listener<ReadableEvents[K]>) {
		const unsubscribe = super.on(event, listener)

		// If this is the first 'data' listener and we have buffered data, replay it
		if (event === 'data' && this.buffer.length > 0) {
			// Replay all buffered chunks asynchronously to avoid reentrancy issues
			queueMicrotask(() => {
				for (const chunk of this.buffer) {
					;(listener as Listener<KernelStdioChunk>)(chunk)
				}
			})
		}

		return unsubscribe
	}

	private closed = false
	private ended = false

	constructor(private readonly port: MessagePort) {
		super()
		if (typeof Atomics === 'object' && typeof Atomics.wait === 'function') {
			this.waitBuffer = new SharedArrayBuffer(4)
			this.waitView = new Int32Array(this.waitBuffer)
		} else {
			this.waitBuffer = null
			this.waitView = null
		}
		port.addEventListener('message', this.handleMessage)
		port.start()
	}

	/**
	 * @TODO: Implement a blocking read() method that will wait for the next
	 *        stdin chunk or the end of the stream.
	 */
	read() {
		if (this.buffer.length > 0) {
			return this.buffer.shift()!
		}
		if (this.ended || this.closed) {
			return null
		}
		if (this.waitView) {
			while (!this.ended && !this.closed && this.buffer.length === 0) {
				Atomics.store(this.waitView, 0, 0)
				const result = Atomics.wait(
					this.waitView,
					0,
					0,
					MessagePortReadableStream.WAIT_TIMEOUT_MS
				)
				if (result === 'timed-out') {
					continue
				}
			}
		} else {
			while (!this.ended && !this.closed && this.buffer.length === 0) {
				Atomics.fence()
			}
		}
		return this.buffer.length > 0 ? this.buffer.shift()! : null
	}

	isClosed() {
		return this.closed
	}

	isEnded() {
		return this.ended
	}

	close(fromRemote = false) {
		if (this.closed) return
		this.closed = true
		if (!fromRemote && !this.remoteClosed) {
			try {
				this.port.postMessage({ type: 'close' })
			} catch {
				// ignore signalling errors
			}
		}
		this.port.removeEventListener('message', this.handleMessage)
		this.port.close()
		if (this.waitView) {
			Atomics.store(this.waitView, 0, 1)
			Atomics.notify(this.waitView, 0)
		}
		this.emit('close', undefined as unknown as void)
		this.clearAll()
	}

	destroy() {
		this.close()
	}
}

export class MessagePortWritableStream extends BasicEventEmitter<WritableEvents> {
	private closed = false
	private remoteClosed = false
	private readonly logLabel: string | null
	private readonly handleMessage = (event: MessageEvent) => {
		const payload = event.data
		if (!payload || typeof payload !== 'object') {
			return
		}
		if (payload.type === 'end' || payload.type === 'close') {
			this.remoteClosed = true
			this.logClose('<remote closed>')
			this.destroy()
		}
	}

	constructor(
		private readonly port: MessagePort,
		options?: { debugLabel?: string }
	) {
		super()
		this.logLabel = options?.debugLabel ?? null
		port.start()
		port.addEventListener('message', this.handleMessage)
	}

	on<K extends keyof ReadableEvents>(
		event: K,
		listener: (value: ReadableEvents[K]) => void
	) {
		const unsubscribe = super.on(event, listener)
		if (event === 'data' && this.buffer.length > 0) {
			while (this.buffer.length > 0) {
				listener(this.buffer.shift() as ReadableEvents[K])
			}
		}
		if (event === 'end' && (this.ended || this.closed)) {
			queueMicrotask(() => listener(undefined as ReadableEvents[K]))
		}
		if (event === 'close' && this.closed) {
			queueMicrotask(() => listener(undefined as ReadableEvents[K]))
		}
		return unsubscribe
	}

	write(chunk: KernelStdioChunk) {
		if (this.closed) return false
		try {
			this.logChunk(chunk)
			this.port.postMessage({ type: 'data', payload: chunk })
			return true
		} catch {
			this.close()
			return false
		}
	}

	end(chunk?: KernelStdioChunk) {
		if (this.closed) return false
		if (typeof chunk !== 'undefined') {
			this.logChunk(chunk)
			this.write(chunk)
		}
		this.logClose('<EOF>')
		this.signalAndClose('end')
		return true
	}

	close() {
		if (this.closed) return false
		this.logClose('<closed>')
		this.signalAndClose('close')
		return true
	}

	destroy() {
		if (this.closed) return
		this.closed = true
		this.port.removeEventListener('message', this.handleMessage)
		this.port.close()
		this.emit('close', undefined as unknown as void)
		this.clearAll()
	}

	private signalAndClose(type: 'end' | 'close') {
		try {
			if (!this.remoteClosed) {
				this.port.postMessage({ type })
			}
		} finally {
			this.destroy()
		}
	}

	private logChunk(chunk: KernelStdioChunk) {
		if (!this.logLabel) {
			return
		}
		const text =
			typeof chunk === 'string'
				? chunk
				: MessagePortWritableStream.decodeForLog(chunk)
		console.log(`[${this.logLabel}] ${text}`)
	}

	private logClose(reason: string) {
		if (!this.logLabel) {
			return
		}
		console.log(`[${this.logLabel}] ${reason}`)
	}

	private static decodeForLog(bytes: Uint8Array): string {
		try {
			const decoder = new TextDecoder()
			return decoder.decode(bytes)
		} catch {
			return `<${bytes.length} bytes>`
		}
	}
}

export { BasicEventEmitter }
