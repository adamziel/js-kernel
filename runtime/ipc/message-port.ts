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
	private readonly handleMessage = (event: MessageEvent) => {
		const payload = event.data
		if (!payload || typeof payload !== 'object') {
			return
		}
		if (payload.type === 'data') {
			this.emit('data', payload.payload)
			this.buffer.push(payload.payload)
		} else if (payload.type === 'end') {
			this.ended = true
			this.emit('end', undefined as unknown as void)
			this.close()
		} else if (payload.type === 'close') {
			this.close()
		}
	}

	private closed = false
	private ended = false

	constructor(private readonly port: MessagePort) {
		super()
		port.addEventListener('message', this.handleMessage)
		port.start()
	}

	/**
	 * @TODO: Implement a blocking read() method that will wait for the next
	 *        stdin chunk or the end of the stream.
	 */
	read() {
		if(!this.buffer.length) {
			return null;
		}
		return this.buffer.shift()
	}

	isClosed() {
		return this.closed
	}

	isEnded() {
		return this.ended
	}

	close() {
		if (this.closed) return
		this.closed = true
		this.port.removeEventListener('message', this.handleMessage)
		this.port.close()
		this.emit('close', undefined as unknown as void)
		this.clearAll()
	}

	destroy() {
		this.close()
	}
}

export class MessagePortWritableStream extends BasicEventEmitter<WritableEvents> {
	private closed = false

	constructor(private readonly port: MessagePort) {
		super()
		port.start()
	}

	write(chunk: KernelStdioChunk) {
		if (this.closed) return false
		try {
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
			this.write(chunk)
		}
		this.signalAndClose('end')
		return true
	}

	close() {
		if (this.closed) return false
		this.signalAndClose('close')
		return true
	}

	destroy() {
		if (this.closed) return
		this.closed = true
		this.port.close()
		this.emit('close', undefined as unknown as void)
		this.clearAll()
	}

	private signalAndClose(type: 'end' | 'close') {
		try {
			this.port.postMessage({ type })
		} finally {
			this.destroy()
		}
	}
}

export { BasicEventEmitter }
