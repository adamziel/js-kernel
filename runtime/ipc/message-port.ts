export type KernelStdioChunk = string | Uint8Array

type Listener<Arg> = (input: Arg) => void

class BasicEventEmitter<Events extends Record<string, unknown>> {
	private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {}

	on<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		if (!this.listeners[event]) {
			this.listeners[event] = new Set()
		}
		this.listeners[event]!.add(listener)
		return () => this.off(event, listener)
	}

	off<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		const listeners = this.listeners[event]
		if (!listeners) return
		listeners.delete(listener)
		if (listeners.size === 0) {
			delete this.listeners[event]
		}
	}

	once<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
		const wrapper: Listener<Events[K]> = (value) => {
			this.off(event, wrapper)
			listener(value)
		}
		return this.on(event, wrapper)
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

interface ReadableEvents {
	data: KernelStdioChunk
	end: void
	close: void
}

interface WritableEvents {
	close: void
}

export class MessagePortReadableStream extends BasicEventEmitter<ReadableEvents> {
	private buffer: KernelStdioChunk[] = []
	private readonly waitBuffer: SharedArrayBuffer | null
	private readonly waitView: Int32Array | null
	private remoteClosed = false
	private closed = false
	private ended = false
	private static readonly WAIT_TIMEOUT_MS = 5000

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

	on<K extends keyof ReadableEvents>(event: K, listener: Listener<ReadableEvents[K]>) {
		const unsubscribe = super.on(event, listener)
		if (event === 'data' && this.buffer.length > 0) {
			queueMicrotask(() => {
				for (const chunk of this.buffer) {
					;(listener as Listener<KernelStdioChunk>)(chunk)
				}
			})
		}
		if (event === 'end' && (this.ended || this.closed)) {
			queueMicrotask(() => listener(undefined as ReadableEvents[K]))
		}
		if (event === 'close' && this.closed) {
			queueMicrotask(() => listener(undefined as ReadableEvents[K]))
		}
		return unsubscribe
	}

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

	private handleMessage = (event: MessageEvent) => {
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
}

export class MessagePortWritableStream extends BasicEventEmitter<WritableEvents> {
	private closed = false
	private remoteClosed = false
	private readonly logLabel: string | null
	private static logDecoder =
		typeof TextDecoder === 'function' ? new TextDecoder() : null

	constructor(
		private readonly port: MessagePort,
		options?: { debugLabel?: string }
	) {
		super()
		this.logLabel = options?.debugLabel ?? null
		port.start()
		port.addEventListener('message', this.handleMessage)
	}

	write(chunk: KernelStdioChunk) {
		if (this.closed) return false
		try {
			this.logChunk(chunk)
			this.port.postMessage({ type: 'data', payload: chunk })
			return true
		} catch {
			this.destroy()
			return false
		}
	}

	end(chunk?: KernelStdioChunk) {
		if (this.closed) return false
		if (typeof chunk !== 'undefined') {
			this.write(chunk)
		}
		this.signalAndClose('end', '<EOF>')
		return true
	}

	close() {
		if (this.closed) return false
		this.signalAndClose('close', '<closed>')
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

	private handleMessage = (event: MessageEvent) => {
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

	private signalAndClose(type: 'end' | 'close', label: string) {
		if (this.closed) return
		this.logClose(label)
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
			const decoder = MessagePortWritableStream.logDecoder
			if (decoder) {
				return decoder.decode(bytes)
			}
		} catch {
			// fall through to generic representation
		}
		return `<${bytes.length} bytes>`
	}
}

export { BasicEventEmitter }
