/// <reference lib="webworker" />
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/no-misused-new */
/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { MessagePort as NodeMessagePort } from 'worker_threads'

/**
 * Comlink library protocol extension to use synchronous messaging.
 *
 * Debugging Asyncify is too much of a burden. This extension enables exchanging
 * messages between threads synchronously so that we don't need to rely on Asyncify.
 *
 * Upsides:
 *
 * * Saves dozens-to-hundreds of hours on debugging Asyncify issues
 * * Increased reliability
 * * Useful stack traces when errors do happen.
 *
 * Downsides:
 *
 * * Fragmentation: Both synchronous and asynchronous handlers exist to get the best our of both
 *   Asyncify and JSPI.
 * * Limited: It works either in Node.js or in browser environments with SharedArrayBuffer enabled.
 * * Message passing between workers is slow. Avoid using synchronous messaging for syscalls that
 *   are invoked frequently and handled asynchronously in the same worker.
 *
 * @see https://github.com/adamziel/js-synchronous-messaging for additional ideas.
 * @see https://github.com/WordPress/wordpress-playground/blob/9a9262cc62cc161d220a9992706b9ed2817f2eb5/packages/docs/site/docs/developers/23-architecture/07-wasm-asyncify.md
 */
interface SyncMessage {
	/** original Comlink envelope            */
	id?: string
	type: MessageType
	/** existing Comlink fields …            */
	[k: string]: any
	/** new part that carries the latch      */
	notifyBuffer?: SharedArrayBuffer
	__comlinkTransfers?: Transferable[]
}

interface SyncTransport {
	afterResponseSent(ev: MessageEvent): void
	send(
		ep: IsomorphicMessagePort,
		msg: Omit<SyncMessage, 'id' | 'notifyBuffer'>,
		transferables?: Transferable[]
	): WireValue
	initiateSyncConnection?(port: IsomorphicMessagePort): Promise<void>
}

export function exposeSync(
	obj: any,
	ep: Endpoint,
	transport: SyncTransport,
	allowedOrigins: (string | RegExp)[] = ['*']
) {
	return expose(obj, ep, allowedOrigins, transport.afterResponseSent)
}

//////////////////////////////
// 3. Consumer side         //
//////////////////////////////

function createSyncProxy<T>(
	ep: IsomorphicMessagePort,
	path: (string | number | symbol)[] = [],
	transport: SyncTransport
): T {
	return new Proxy(() => {}, {
		get(_t, prop) {
			if (prop === 'then') {
				// allow await‑usage without deadlocking
				if (!path.length)
					return {
						then: (_: any, res: any) =>
							res(createSyncProxy(ep, [], transport)),
					}
			}
			return createSyncProxy(ep, [...path, prop], transport)
		},

		set(_t, prop, value) {
			const [v, xfer] = toWireValue(value)
			transport.send(
				ep,
				{
					type: MessageType.SET,
					path: [...path, prop].map(String),
					value: v,
				},
				xfer
			)
			return true
		},

		apply(_t, _thisArg, rawArgs) {
			// Special cases
			const last = path.at(-1)
			if (last === 'bind')
				return createSyncProxy(ep, path.slice(0, -1), transport)

			const [argList, xfer] = processArguments(rawArgs)
			const wire = transport.send(
				ep,
				{
					type: MessageType.APPLY,
					path: path.map(String),
					argumentList: argList,
				},
				xfer
			)

			return fromWireValue(wire)
		},

		construct(_t, rawArgs) {
			const [argList, xfer] = processArguments(rawArgs)
			const wire = transport.send(
				ep,
				{
					type: MessageType.CONSTRUCT,
					path: path.map(String),
					argumentList: argList,
				},
				xfer
			)
			return fromWireValue(wire)
		},
	}) as unknown as T
}

type SyncWrapEndpoint = IsomorphicMessagePort | Endpoint | Worker

export async function wrapSync<T>(
	endpoint: SyncWrapEndpoint,
	transport?: SyncTransport
): Promise<T> {
	const port = await endpointToMessagePort(endpoint)

	transport = transport ?? (await createSyncTransport())
	await transport.initiateSyncConnection?.(port)

	return createSyncProxy<T>(port, [], transport)
}

async function endpointToMessagePort(
	endpoint: any
): Promise<IsomorphicMessagePort> {
	if (!endpoint) {
		throw new TypeError(
			'wrapSync expects a MessagePort, Worker, or Comlink Endpoint'
		)
	}

	// If we already have a message port–like object, return it
	const seemsLikeMessagePort =
		typeof endpoint.postMessage === 'function' &&
		typeof endpoint.close === 'function'
	if (seemsLikeMessagePort) {
		return endpoint as IsomorphicMessagePort
	}

	// Otherwise, only accept endpoint–like objects...
	const seemsLikeEndpoint =
		typeof endpoint.postMessage === 'function' &&
		typeof endpoint.addEventListener === 'function' &&
		typeof endpoint.removeEventListener === 'function'
	if (!seemsLikeEndpoint) {
		throw new TypeError(
			'wrapSync expects a MessagePort, Worker, or Comlink Endpoint'
		)
	}

	// ...and convert it to a message port
	return new Promise<MessagePort>((resolve, reject) => {
		const messageId = generateUUID()
		const responseHandler: EventListener = (event) => {
			const { data } = event as MessageEvent<WireValue>
			if (!data || (data as any).id !== messageId) {
				return
			}
			cleanup()
			const port = fromWireValue(data) as MessagePort
			if (typeof port.start === 'function') {
				port.start()
			}
			resolve(port)
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error('Timed out acquiring synchronous message port'))
		}, SABAtomicsWaitSyncToAsyncTransport.handshakeTimeoutMs)

		function cleanup() {
			clearTimeout(timeout)
			endpoint.removeEventListener('message', responseHandler)
		}

		endpoint.addEventListener('message', responseHandler)
		endpoint.start?.()
		endpoint.postMessage({ id: messageId, type: MessageType.ENDPOINT })
	})
}

/// Transport ///

export type IsomorphicMessagePort = MessagePort | NodeMessagePort

export class NodeSABSyncReceiveMessageTransport implements SyncTransport {
	private static receiveMessageOnPort: any

	/**
	 * Creates a new transport instance while also initializing the
	 * receiveMessageOnPort function. We're using this hack because we
	 * don't have many other options:
	 *
	 * * We can't initialize it in the constructor because it's async.
	 * * We can't initialize it in a top-level code block – await won't work
	 *   for CommonJS build target.
	 * * We can't expose a static receiveMessageOnPort method runs these requires/imports
	 *   upon the first call because, again, this logic is async and receiveMessageOnPort()
	 *   must be synchronous.
	 *
	 * @returns
	 */
	static async create(): Promise<NodeSABSyncReceiveMessageTransport> {
		if (!NodeSABSyncReceiveMessageTransport.receiveMessageOnPort) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				NodeSABSyncReceiveMessageTransport.receiveMessageOnPort =
					require('worker_threads').receiveMessageOnPort
			} catch {
				NodeSABSyncReceiveMessageTransport.receiveMessageOnPort =
					await import('worker_threads').then(
						(mod) => mod.receiveMessageOnPort
					)
			}
		}
		return new NodeSABSyncReceiveMessageTransport()
	}

	private constructor() {}

	afterResponseSent(ev: MessageEvent) {
		const { notifyBuffer } = ev.data as SyncMessage
		if (notifyBuffer) {
			const view = new Int32Array(notifyBuffer)
			view[0] = 1
			Atomics.notify(view, 0)
		}
	}

	send(
		ep: IsomorphicMessagePort,
		msg: Omit<SyncMessage, 'id' | 'notifyBuffer'>,
		transferables: Transferable[] = []
	): WireValue {
		const latch = new SharedArrayBuffer(4)
		const view = new Int32Array(latch)
		view[0] = 0

		const id = generateUUID()
		ep.postMessage(
			{ ...msg, id, notifyBuffer: latch },
			transferables as any
		)

		const timeoutMs = 5000
		const result = Atomics.wait(view, 0, 0, timeoutMs)
		if (result === 'timed-out') {
			throw new Error('Timeout waiting for response')
		}
		while (true) {
			const res =
				NodeSABSyncReceiveMessageTransport.receiveMessageOnPort(ep)
			if (res?.message?.id === id) {
				return res.message
			}
			if (!res) {
				throw new Error('No response received')
			}
		}
	}
}

const STATE_EMPTY = 0
const STATE_FULL = 1
const STATE_CLOSED = -1
const FLAG_MORE = 1

type BrowserSyncConnection = {
	worker: Worker
	commandPort: MessagePort
	control: Int32Array
	payload: Uint8Array
	ctrlSAB: SharedArrayBuffer
	bufSAB: SharedArrayBuffer
	pendingResponses: { message: any }[]
}

/**
 * Allows consuming asynchronous Comlink endpoints using synchronous function calls! ✨
 * 
 * It spawns an intermediary `syncBridgeWorker` that communicates synchronously with
 * the current worker and asynchronously with the target async endpoint.
 * 
 * Synchronous communication is achieved as follows:
 * 
 * 1. The current worker uses Atomics.wait() to block until a message
 *    is available in the SharedArrayBuffer.
 * 2. `syncBridgeWorker` writes a message to a SharedArrayBuffer
 * 3. The current worker reads the message from the SharedArrayBuffer, JSON-parses it,
 *    and processes it.
 * 
 *    note this means we can only exchange JSON-serializable values. Transferables are
 *    not supported.
 * 
 * Meanwhile, the `syncBridgeWorker` communicates asynchronously with the target async endpoint
 * using the typical MessagePort.postMessage() mechanism.
 */
export class SABAtomicsWaitSyncToAsyncTransport implements SyncTransport {
	private static browserConnections = new WeakMap<
		MessagePort,
		BrowserSyncConnection
	>()
	private static browsersyncBridgeWorkerUrl?: string
	private static textDecoder: TextDecoder | undefined
	public static readonly handshakeTimeoutMs = 5000
	private static readonly browserBufferBytes = 1 << 20

	private static readonly syncBridgeWorkerSource =
		'syncBridgeWorker(); ' +
		function syncBridgeWorker() {
			const STATE_EMPTY = 0
			const STATE_FULL = 1
			const STATE_CLOSED = -1
			const FLAG_MORE = 1
			const encoder = new TextEncoder()
			const pendingLatches = new Map()

			function handleInitMessage(data) {
				const port = data.port
				const commandPort = data.commandPort
				const control = new Int32Array(data.ctrl, 0, 3)
				const payload = new Uint8Array(data.buf)
				const signal = new Int32Array(data.handshake)

				function closesyncBridge() {
					Atomics.store(control, 0, STATE_CLOSED)
					Atomics.notify(control, 0)
					try {
						if (typeof port.close === 'function') {
							port.close()
						}
					} catch {}
					try {
						if (typeof commandPort.close === 'function') {
							commandPort.close()
						}
					} catch {}
				}

				listen(commandPort, (messageData) => {
					if (!messageData || typeof messageData !== 'object') {
						return
					}
					switch (messageData.type) {
						case 'request': {
							const message = messageData.message || {}
							const transfers = message.__comlinkTransfers || []
							if ('__comlinkTransfers' in message) {
								delete message.__comlinkTransfers
							}
							const id = message && message.id
							if (
								id !== undefined &&
								messageData.notifyBuffer instanceof
									SharedArrayBuffer
							) {
								pendingLatches.set(
									String(id),
									messageData.notifyBuffer
								)
							}
							port.postMessage(message, transfers)
							break
						}
						case 'close': {
							for (const buffer of pendingLatches.values()) {
								try {
									const view = new Int32Array(buffer)
									view[0] = 1
									Atomics.notify(view, 0)
								} catch {}
							}
							pendingLatches.clear()
							closesyncBridge()
							break
						}
					}
				})

				listen(port, (payloadData) => {
					const json = JSON.stringify(payloadData)
					const bytes = encoder.encode(json)
					let offset = 0
					while (offset < bytes.length) {
						const state = waitUntilEmptyOrClosed(control)
						if (state === STATE_CLOSED) {
							return
						}

						const chunkSize = Math.min(
							payload.byteLength,
							bytes.length - offset
						)
						payload.set(bytes.subarray(offset, offset + chunkSize))
						Atomics.store(control, 1, chunkSize)
						Atomics.store(
							control,
							2,
							offset + chunkSize < bytes.length ? FLAG_MORE : 0
						)
						Atomics.store(control, 0, STATE_FULL)
						Atomics.notify(control, 0, 1)
						offset += chunkSize
					}

					const responseId =
						payloadData && typeof payloadData === 'object'
							? payloadData.id
							: undefined
					if (responseId !== undefined) {
						const buffer = pendingLatches.get(String(responseId))
						if (buffer) {
							pendingLatches.delete(String(responseId))
							try {
								const view = new Int32Array(buffer)
								view[0] = 1
								Atomics.notify(view, 0)
							} catch {}
						}
					}
				})

				if (typeof port.start === 'function') {
					port.start()
				}
				if (typeof commandPort.start === 'function') {
					commandPort.start()
				}

				Atomics.store(signal, 0, 1)
				Atomics.notify(signal, 0)
			}

			function listen(target, handler) {
				if (!target) return
				if (typeof target.addEventListener === 'function') {
					target.addEventListener('message', (event) =>
						handler(event.data)
					)
				} else if ('onmessage' in target) {
					target.onmessage = (event) => handler(event.data)
				} else if (typeof target.on === 'function') {
					target.on('message', (value) => handler(value))
				}
			}

			function waitUntilEmptyOrClosed(control) {
				for (;;) {
					const state = Atomics.load(control, 0) as unknown as number
					if (state === STATE_EMPTY || state < 0) {
						return state
					}
					Atomics.wait(control, 0, state)
				}
			}

			const parentPort =
				typeof require === 'function'
					? (() => {
							try {
								return require('worker_threads').parentPort
							} catch {
								return null
							}
					  })()
					: null
			const workerScope =
				typeof self !== 'undefined'
					? (self as DedicatedWorkerGlobalScope)
					: globalThis
			const parentEndpoint = parentPort || workerScope

			listen(parentEndpoint, (data) => {
				if (!data || data.type !== 'init') {
					return
				}
				try {
					handleInitMessage(data)
				} catch (error) {
					const signal = new Int32Array(data.handshake)
					Atomics.store(signal, 0, -1)
					Atomics.notify(signal, 0)
					throw error
				}
				parentEndpoint.postMessage({ type: 'init-done' })
			})
		}

	static async create(): Promise<SABAtomicsWaitSyncToAsyncTransport> {
		SABAtomicsWaitSyncToAsyncTransport.assertSupport()
		return new SABAtomicsWaitSyncToAsyncTransport()
	}

	private constructor() {}

	async initiateSyncConnection(port: MessagePort): Promise<void> {
		await SABAtomicsWaitSyncToAsyncTransport.ensureConnection(port)
	}

	afterResponseSent(ev: MessageEvent) {
		const { notifyBuffer } = ev.data as SyncMessage
		if (notifyBuffer) {
			const view = new Int32Array(notifyBuffer)
			view[0] = 1
			Atomics.notify(view, 0)
		}
	}

	send(
		ep: IsomorphicMessagePort,
		msg: Omit<SyncMessage, 'id' | 'notifyBuffer'>,
		transferables: Transferable[] = []
	): WireValue {
		if (!SABAtomicsWaitSyncToAsyncTransport.isMessagePort(ep)) {
			throw new TypeError(
				'SABAtomicsWaitTransport expects a MessagePort endpoint'
			)
		}
		const connection =
			SABAtomicsWaitSyncToAsyncTransport.browserConnections.get(
				ep as MessagePort
			)
		if (!connection) {
			throw new Error(
				'SABAtomicsWaitTransport endpoint not initialized; call wrapSync() first'
			)
		}
		return SABAtomicsWaitSyncToAsyncTransport.sendThroughConnection(
			connection,
			msg,
			transferables
		)
	}

	private static isMessagePort(value: unknown): value is MessagePort {
		return (
			typeof value === 'object' &&
			value !== null &&
			'postMessage' in value &&
			typeof (value as MessagePort).postMessage === 'function'
		)
	}

	private static sendThroughConnection(
		connection: BrowserSyncConnection,
		msg: Omit<SyncMessage, 'id' | 'notifyBuffer'>,
		transferables: Transferable[]
	): WireValue {
		const latch = new SharedArrayBuffer(4)
		const view = new Int32Array(latch)
		view[0] = 0

		const id = generateUUID()
		const message = { ...msg, id, notifyBuffer: latch } as SyncMessage

		if (transferables.length) {
			Object.defineProperty(message, '__comlinkTransfers', {
				value: transferables,
				configurable: true,
			})
		}

		connection.commandPort.postMessage(
			{ type: 'request', message, notifyBuffer: latch },
			transferables as any
		)

		if ('__comlinkTransfers' in message) {
			delete (message as Record<string, unknown>).__comlinkTransfers
		}

		const waitResult = Atomics.wait(
			view,
			0,
			0,
			SABAtomicsWaitSyncToAsyncTransport.handshakeTimeoutMs
		)
		if (waitResult === 'timed-out') {
			throw new Error('Timeout waiting for response')
		}

		while (true) {
			const res =
				SABAtomicsWaitSyncToAsyncTransport.receiveMessageOnPort(
					connection
				)
			if (!res) {
				throw new Error('No response received')
			}
			if (res.message?.id === id) {
				return res.message
			}
			connection.pendingResponses.push(res)
			if (connection.pendingResponses.length > 100) {
				// avoid unbounded growth
				connection.pendingResponses.shift()
			}
		}
	}

	private static assertSupport() {
		if (typeof SharedArrayBuffer === 'undefined') {
			throw new Error(
				'SharedArrayBuffer is required for synchronous transport'
			)
		}
		if (
			typeof Atomics === 'undefined' ||
			typeof Atomics.wait !== 'function'
		) {
			throw new Error(
				'Atomics.wait is required for synchronous transport'
			)
		}
		if (typeof MessageChannel === 'undefined') {
			throw new Error(
				'MessageChannel is required for synchronous transport'
			)
		}
		if (typeof Worker === 'undefined' && typeof require !== 'function') {
			throw new Error('Worker API is required for synchronous transport')
		}
	}

	private static async ensureConnection(
		port: MessagePort
	): Promise<BrowserSyncConnection> {
		const existing =
			SABAtomicsWaitSyncToAsyncTransport.browserConnections.get(port)
		if (existing) {
			return existing
		}

		const ctrlSAB = new SharedArrayBuffer(16)
		const bufSAB = new SharedArrayBuffer(
			SABAtomicsWaitSyncToAsyncTransport.browserBufferBytes
		)
		const control = new Int32Array(ctrlSAB, 0, 3)
		const payload = new Uint8Array(bufSAB)
		control[0] = STATE_EMPTY
		control[1] = 0
		control[2] = 0

		const handshakeSAB = new SharedArrayBuffer(4)
		const handshake = new Int32Array(handshakeSAB)
		handshake[0] = 0

		const { port1: commandPortForWorker, port2: commandPortForClient } =
			new MessageChannel()

		const worker =
			SABAtomicsWaitSyncToAsyncTransport.createsyncBridgeWorker()

		worker.postMessage(
			{
				type: 'init',
				port,
				ctrl: ctrlSAB,
				buf: bufSAB,
				commandPort: commandPortForWorker,
				handshake: handshakeSAB,
			},
			[port, commandPortForWorker]
		)

		await new Promise((resolve, reject) => {
			worker.onmessage = (event) => {
				if (event.data.type === 'init-done') {
					resolve(void 0)
				}
			}
			worker.onerror = (event) => {
				reject(event.error)
			}
		})

		const waitResult = Atomics.wait(
			handshake,
			0,
			0,
			SABAtomicsWaitSyncToAsyncTransport.handshakeTimeoutMs
		)
		if (waitResult === 'timed-out') {
			worker.terminate()
			throw new Error(
				'Timed out waiting for synchronous transport sync bridge worker'
			)
		}

		const status = Atomics.load(handshake, 0)
		if (status !== 1) {
			worker.terminate()
			throw new Error(
				'Synchronous transport sync bridge worker failed to initialize'
			)
		}

		if (typeof commandPortForClient.start === 'function') {
			commandPortForClient.start()
		}

		const connection: BrowserSyncConnection = {
			worker,
			commandPort: commandPortForClient,
			control,
			payload,
			ctrlSAB,
			bufSAB,
			pendingResponses: [],
		}
		SABAtomicsWaitSyncToAsyncTransport.browserConnections.set(
			port,
			connection
		)
		return connection
	}

	private static createsyncBridgeWorker(): Worker {
		const WorkerCtor =
			typeof Worker !== 'undefined' ? Worker : (globalThis as any)?.Worker
		if (WorkerCtor) {
			try {
				return new WorkerCtor(
					SABAtomicsWaitSyncToAsyncTransport.getsyncBridgeWorkerUrl(),
					{
						name: 'comlink-sync-sync bridge',
					}
				)
			} catch {
				try {
					return new (WorkerCtor as any)(
						SABAtomicsWaitSyncToAsyncTransport.syncBridgeWorkerSource,
						{ eval: true, name: 'comlink-sync-sync bridge' }
					)
				} catch {
					// fall through
				}
			}
		}
		if (typeof require === 'function') {
			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const { Worker: NodeWorker } = require('worker_threads')
				return new NodeWorker(
					SABAtomicsWaitSyncToAsyncTransport.syncBridgeWorkerSource,
					{
						eval: true,
						name: 'comlink-sync-sync bridge',
					}
				)
			} catch {
				// ignore
			}
		}
		throw new Error('Worker API is required for synchronous transport')
	}

	private static getsyncBridgeWorkerUrl(): string {
		if (!SABAtomicsWaitSyncToAsyncTransport.browsersyncBridgeWorkerUrl) {
			const supportsBlob =
				typeof Blob !== 'undefined' &&
				typeof URL !== 'undefined' &&
				typeof URL.createObjectURL === 'function'
			if (!supportsBlob) {
				throw new Error(
					'Blob and URL APIs are required for synchronous transport'
				)
			}
			const blob = new Blob(
				[SABAtomicsWaitSyncToAsyncTransport.syncBridgeWorkerSource],
				{
					type: 'text/javascript',
				}
			)
			SABAtomicsWaitSyncToAsyncTransport.browsersyncBridgeWorkerUrl =
				URL.createObjectURL(blob)
		}
		return SABAtomicsWaitSyncToAsyncTransport.browsersyncBridgeWorkerUrl
	}

	private static receiveMessageOnPort(
		connection: BrowserSyncConnection,
		options?: { timeoutMs?: number }
	): { message: any } | undefined {
		if (connection.pendingResponses.length) {
			return connection.pendingResponses.shift()
		}
		const pieces: Uint8Array[] = []
		let total = 0

		for (;;) {
			const state = Atomics.load(connection.control, 0)
			if (state === STATE_FULL) {
				const len = Atomics.load(connection.control, 1)
				const flags = Atomics.load(connection.control, 2)
				const chunk = connection.payload.slice(0, len)

				Atomics.store(connection.control, 0, STATE_EMPTY)
				Atomics.notify(connection.control, 0, 1)

				pieces.push(chunk)
				total += len

				if ((flags & FLAG_MORE) === 0) {
					const bytes = new Uint8Array(total)
					let offset = 0
					for (const part of pieces) {
						bytes.set(part, offset)
						offset += part.length
					}
					const decoder =
						SABAtomicsWaitSyncToAsyncTransport.textDecoder ||
						new TextDecoder()
					SABAtomicsWaitSyncToAsyncTransport.textDecoder = decoder
					const json = decoder.decode(bytes)
					return { message: JSON.parse(json) }
				}
				continue
			}

			if (state === STATE_CLOSED) {
				return undefined
			}

			if (options?.timeoutMs !== undefined) {
				const res = Atomics.wait(
					connection.control,
					0,
					state,
					options.timeoutMs
				)
				if (res === 'timed-out') {
					return undefined
				}
			} else {
				Atomics.wait(connection.control, 0, state)
			}
		}
	}
}

export async function createSyncTransport(): Promise<SyncTransport> {
	if (await canAccessWorkerThreads()) {
		try {
			return await NodeSABSyncReceiveMessageTransport.create()
		} catch {
			// fall through to SharedArrayBuffer transport
		}
	}
	return SABAtomicsWaitSyncToAsyncTransport.create()
}

async function canAccessWorkerThreads(): Promise<boolean> {
	if (typeof require === 'function') {
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			require('worker_threads')
			return true
		} catch {
			// ignore
		}
	}
	try {
		await import('worker_threads')
		return true
	} catch {
		return false
	}
}

/**
 * Original, unmodified Comlink library from Google:
 *
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const proxyMarker = Symbol('Comlink.proxy')
export const createEndpoint = Symbol('Comlink.endpoint')
export const releaseProxy = Symbol('Comlink.releaseProxy')
export const finalizer = Symbol('Comlink.finalizer')

const throwMarker = Symbol('Comlink.thrown')

/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface EventSource {
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: object
	): void

	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: object
	): void
}

export interface PostMessageWithOrigin {
	postMessage(
		message: any,
		targetOrigin: string,
		transfer?: Transferable[]
	): void
}

export interface Endpoint extends EventSource {
	postMessage(message: any, transfer?: Transferable[]): void

	start?: () => void
}

export const WireValueType = {
	RAW: 'RAW',
	PROXY: 'PROXY',
	THROW: 'THROW',
	HANDLER: 'HANDLER',
} as const

export type WireValueType = typeof WireValueType

export interface RawWireValue {
	id?: string
	type: WireValueType['RAW']
	value: any
}

export interface HandlerWireValue {
	id?: string
	type: WireValueType['HANDLER']
	name: string
	value: unknown
}

export type WireValue = RawWireValue | HandlerWireValue

export type MessageID = string

export const MessageType = {
	GET: 'GET',
	SET: 'SET',
	APPLY: 'APPLY',
	CONSTRUCT: 'CONSTRUCT',
	ENDPOINT: 'ENDPOINT',
	RELEASE: 'RELEASE',
} as const
export type MessageType = typeof MessageType

export interface GetMessage {
	id?: MessageID
	type: MessageType['GET']
	path: string[]
}

export interface SetMessage {
	id?: MessageID
	type: MessageType['SET']
	path: string[]
	value: WireValue
}

export interface ApplyMessage {
	id?: MessageID
	type: MessageType['APPLY']
	path: string[]
	argumentList: WireValue[]
}

export interface ConstructMessage {
	id?: MessageID
	type: MessageType['CONSTRUCT']
	path: string[]
	argumentList: WireValue[]
}

export interface EndpointMessage {
	id?: MessageID
	type: MessageType['ENDPOINT']
}

export interface ReleaseMessage {
	id?: MessageID
	type: MessageType['RELEASE']
}

export type Message =
	| GetMessage
	| SetMessage
	| ApplyMessage
	| ConstructMessage
	| EndpointMessage
	| ReleaseMessage

/**
 * Interface of values that were marked to be proxied with `comlink.proxy()`.
 * Can also be implemented by classes.
 */
export interface ProxyMarked {
	[proxyMarker]: true
}

/**
 * Takes a type and wraps it in a Promise, if it not already is one.
 * This is to avoid `Promise<Promise<T>>`.
 *
 * This is the inverse of `Unpromisify<T>`.
 */
type Promisify<T> = T extends Promise<unknown> ? T : Promise<T>
/**
 * Takes a type that may be Promise and unwraps the Promise type.
 * If `P` is not a Promise, it returns `P`.
 *
 * This is the inverse of `Promisify<T>`.
 */
type Unpromisify<P> = P extends Promise<infer T> ? T : P

/**
 * Takes the raw type of a remote property and returns the type that is visible to the local thread
 * on the proxy.
 *
 * Note: This needs to be its own type alias, otherwise it will not distribute over unions.
 * See https://www.typescriptlang.org/docs/handbook/advanced-types.html#distributive-conditional-types
 */
type RemoteProperty<T> =
	// If the value is a method, comlink will proxy it automatically.
	// Objects are only proxied if they are marked to be proxied.
	// Otherwise, the property is converted to a Promise that resolves the cloned value.
	T extends Function | ProxyMarked ? Remote<T> : Promisify<T>

/**
 * Takes the raw type of a property as a remote thread would see it through a proxy (e.g. when
 * passed in as a function argument) and returns the type that the local thread has to supply.
 *
 * This is the inverse of `RemoteProperty<T>`.
 *
 * Note: This needs to be its own type alias, otherwise it will not distribute over unions. See
 * https://www.typescriptlang.org/docs/handbook/advanced-types.html#distributive-conditional-types
 */
type LocalProperty<T> = T extends Function | ProxyMarked
	? Local<T>
	: Unpromisify<T>

/**
 * Proxies `T` if it is a `ProxyMarked`, clones it otherwise (as handled by structured cloning and
 * transfer handlers).
 */
export type ProxyOrClone<T> = T extends ProxyMarked ? Remote<T> : T
/**
 * Inverse of `ProxyOrClone<T>`.
 */
export type UnproxyOrClone<T> = T extends RemoteObject<ProxyMarked>
	? Local<T>
	: T

/**
 * Takes the raw type of a remote object in the other thread and returns the type as it is visible
 * to the local thread when proxied with `Comlink.proxy()`.
 *
 * This does not handle call signatures, which is handled by the more general `Remote<T>` type.
 *
 * @template T The raw type of a remote object as seen in the other thread.
 */
export type RemoteObject<T> = { [P in keyof T]: RemoteProperty<T[P]> }
/**
 * Takes the type of an object as a remote thread would see it through a proxy (e.g. when passed in
 * as a function argument) and returns the type that the local thread has to supply.
 *
 * This does not handle call signatures, which is handled by the more general `Local<T>` type.
 *
 * This is the inverse of `RemoteObject<T>`.
 *
 * @template T The type of a proxied object.
 */
export type LocalObject<T> = { [P in keyof T]: LocalProperty<T[P]> }

/**
 * Additional special comlink methods available on each proxy returned by `Comlink.wrap()`.
 */
export interface ProxyMethods {
	[createEndpoint]: () => Promise<MessagePort>
	[releaseProxy]: () => void
}

/**
 * Takes the raw type of a remote object, function or class in the other thread and returns the
 * type as it is visible to the local thread from the proxy return value of `Comlink.wrap()` or
 * `Comlink.proxy()`.
 */
export type Remote<T> =
	// Handle properties
	RemoteObject<T> &
		// Handle call signature (if present)
		(T extends (...args: infer TArguments) => infer TReturn
			? (
					...args: {
						[I in keyof TArguments]: UnproxyOrClone<TArguments[I]>
					}
			  ) => Promisify<ProxyOrClone<Unpromisify<TReturn>>>
			: unknown) &
		// Handle construct signature (if present)
		// The return of construct signatures is always proxied (whether marked or not)
		(T extends { new (...args: infer TArguments): infer TInstance }
			? {
					new (
						...args: {
							[I in keyof TArguments]: UnproxyOrClone<
								TArguments[I]
							>
						}
					): Promisify<Remote<TInstance>>
			  }
			: unknown) &
		// Include additional special comlink methods available on the proxy.
		ProxyMethods

/**
 * Expresses that a type can be either a sync or async.
 */
type MaybePromise<T> = Promise<T> | T

/**
 * Takes the raw type of a remote object, function or class as a remote thread would see it through
 * a proxy (e.g. when passed in as a function argument) and returns the type the local thread has
 * to supply.
 *
 * This is the inverse of `Remote<T>`. It takes a `Remote<T>` and returns its original input `T`.
 */
export type Local<T> =
	// Omit the special proxy methods (they don't need to be supplied, comlink adds them)
	Omit<LocalObject<T>, keyof ProxyMethods> &
		// Handle call signatures (if present)
		(T extends (...args: infer TArguments) => infer TReturn
			? (
					...args: {
						[I in keyof TArguments]: ProxyOrClone<TArguments[I]>
					}
			  ) => // The raw function could either be sync or async, but is always proxied automatically
			  MaybePromise<UnproxyOrClone<Unpromisify<TReturn>>>
			: unknown) &
		// Handle construct signature (if present)
		// The return of construct signatures is always proxied (whether marked or not)
		(T extends { new (...args: infer TArguments): infer TInstance }
			? {
					new (
						...args: {
							[I in keyof TArguments]: ProxyOrClone<TArguments[I]>
						}
					): // The raw constructor could either be sync or async, but is always proxied automatically
					MaybePromise<Local<Unpromisify<TInstance>>>
			  }
			: unknown)

const isObject = (val: unknown): val is object =>
	(typeof val === 'object' && val !== null) || typeof val === 'function'

/**
 * Customizes the serialization of certain values as determined by `canHandle()`.
 *
 * @template T The input type being handled by this transfer handler.
 * @template S The serialized type sent over the wire.
 */
export interface TransferHandler<T, S> {
	/**
	 * Gets called for every value to determine whether this transfer handler
	 * should serialize the value, which includes checking that it is of the right
	 * type (but can perform checks beyond that as well).
	 */
	canHandle(value: unknown): value is T

	/**
	 * Gets called with the value if `canHandle()` returned `true` to produce a
	 * value that can be sent in a message, consisting of structured-cloneable
	 * values and/or transferrable objects.
	 */
	serialize(value: T): [S, Transferable[]]

	/**
	 * Gets called to deserialize an incoming value that was serialized in the
	 * other thread with this transfer handler (known through the name it was
	 * registered under).
	 */
	deserialize(value: S): T
}

/**
 * Internal transfer handle to handle objects marked to proxy.
 */
const proxyTransferHandler: TransferHandler<object, MessagePort> = {
	canHandle: (val): val is ProxyMarked =>
		isObject(val) && (val as ProxyMarked)[proxyMarker],
	serialize(obj) {
		const { port1, port2 } = new MessageChannel()
		expose(obj, port1)
		return [port2, [port2]]
	},
	deserialize(port) {
		port.start()
		return wrap(port)
	},
}

interface ThrownValue {
	[throwMarker]: unknown // just needs to be present
	value: unknown
}
type SerializedThrownValue =
	| { isError: true; value: Error }
	| { isError: false; value: unknown }
type PendingListenersMap = Map<
	string,
	(value: WireValue | PromiseLike<WireValue>) => void
>

/**
 * Internal transfer handler to handle thrown exceptions.
 */
const throwTransferHandler: TransferHandler<
	ThrownValue,
	SerializedThrownValue
> = {
	canHandle: (value): value is ThrownValue =>
		isObject(value) && throwMarker in value,
	serialize({ value }) {
		let serialized: SerializedThrownValue
		if (value instanceof Error) {
			serialized = {
				isError: true,
				value: {
					message: value.message,
					name: value.name,
					stack: value.stack,
				},
			}
		} else {
			serialized = { isError: false, value }
		}
		return [serialized, []]
	},
	deserialize(serialized) {
		if (serialized.isError) {
			throw Object.assign(
				new Error(serialized.value.message),
				serialized.value
			)
		}
		throw serialized.value
	},
}

/**
 * Allows customizing the serialization of certain values.
 */
export const transferHandlers = new Map<
	string,
	TransferHandler<unknown, unknown>
>([
	['proxy', proxyTransferHandler],
	['throw', throwTransferHandler],
])

function isAllowedOrigin(
	allowedOrigins: (string | RegExp)[],
	origin: string
): boolean {
	for (const allowedOrigin of allowedOrigins) {
		if (origin === allowedOrigin || allowedOrigin === '*') {
			return true
		}
		if (allowedOrigin instanceof RegExp && allowedOrigin.test(origin)) {
			return true
		}
	}
	return false
}

export function expose(
	obj: any,
	ep: Endpoint = globalThis as any,
	allowedOrigins: (string | RegExp)[] = ['*'],
	afterResponseSent?: (ev: MessageEvent) => void
) {
	ep.addEventListener('message', function callback(ev: MessageEvent) {
		if (!ev || !ev.data) {
			return
		}
		if (!isAllowedOrigin(allowedOrigins, ev.origin)) {
			// eslint-disable-next-line no-console
			console.warn(`Invalid origin '${ev.origin}' for comlink proxy`)
			return
		}
		const { id, type, path } = {
			path: [] as string[],
			...(ev.data as Message),
		}
		const argumentList = (ev.data.argumentList || []).map(fromWireValue)
		let returnValue
		try {
			const parent = path
				.slice(0, -1)
				.reduce((obj, prop) => obj[prop], obj)
			const rawValue = path.reduce((obj, prop) => obj[prop], obj)
			switch (type) {
				case MessageType.GET:
					{
						returnValue = rawValue
					}
					break
				case MessageType.SET:
					{
						parent[path.slice(-1)[0]] = fromWireValue(ev.data.value)
						returnValue = true
					}
					break
				case MessageType.APPLY:
					{
						returnValue = rawValue.apply(parent, argumentList)
					}
					break
				case MessageType.CONSTRUCT:
					{
						const value = new rawValue(...argumentList)
						returnValue = proxy(value)
					}
					break
				case MessageType.ENDPOINT:
					{
						const { port1, port2 } = new MessageChannel()
						expose(obj, port2)
						returnValue = transfer(port1, [port1])
					}
					break
				case MessageType.RELEASE:
					{
						returnValue = undefined
					}
					break
				default:
					return
			}
		} catch (value) {
			returnValue = { value, [throwMarker]: 0 }
		}
		Promise.resolve(returnValue)
			.catch((value) => {
				return { value, [throwMarker]: 0 }
			})
			.then((returnValue) => {
				const [wireValue, transferables] = toWireValue(returnValue)
				ep.postMessage({ ...wireValue, id }, transferables)
				if (type === MessageType.RELEASE) {
					// detach and deactive after sending release response above.
					ep.removeEventListener('message', callback as any)
					closeEndPoint(ep)
					if (
						finalizer in obj &&
						typeof obj[finalizer] === 'function'
					) {
						obj[finalizer]()
					}
				}
			})
			.catch(() => {
				// Send Serialization Error To Caller
				const [wireValue, transferables] = toWireValue({
					value: new TypeError('Unserializable return value'),
					[throwMarker]: 0,
				})
				ep.postMessage({ ...wireValue, id }, transferables)
			})
			.finally(() => {
				afterResponseSent?.(ev)
			})
	} as any)
	if (ep.start) {
		ep.start()
	}
}

function isMessagePort(endpoint: Endpoint): endpoint is MessagePort {
	return endpoint.constructor.name === 'MessagePort'
}

function closeEndPoint(endpoint: Endpoint) {
	if (isMessagePort(endpoint)) endpoint.close()
}

export function wrap<T>(ep: Endpoint, target?: any): Remote<T> {
	const pendingListeners: PendingListenersMap = new Map()

	ep.addEventListener('message', function handleMessage(ev: Event) {
		const { data } = ev as MessageEvent
		if (!data || !data.id) {
			return
		}
		const resolver = pendingListeners.get(data.id)
		if (!resolver) {
			return
		}

		try {
			resolver(data)
		} finally {
			pendingListeners.delete(data.id)
		}
	})

	return createProxy<T>(ep, pendingListeners, [], target) as any
}

function throwIfProxyReleased(isReleased: boolean) {
	if (isReleased) {
		throw new Error('Proxy has been released and is not useable')
	}
}

function releaseEndpoint(ep: Endpoint) {
	return requestResponseMessage(ep, new Map(), {
		type: MessageType.RELEASE,
	}).then(() => {
		closeEndPoint(ep)
	})
}

interface FinalizationRegistry<T> {
	// @ts-ignore
	new (cb: (heldValue: T) => void): FinalizationRegistry<T>
	register(
		weakItem: object,
		heldValue: T,
		unregisterToken?: object | undefined
	): void
	unregister(unregisterToken: object): void
}
declare const FinalizationRegistry: FinalizationRegistry<Endpoint>

const proxyCounter = new WeakMap<Endpoint, number>()
const proxyFinalizers =
	'FinalizationRegistry' in globalThis &&
	new FinalizationRegistry((ep: Endpoint) => {
		const newCount = (proxyCounter.get(ep) || 0) - 1
		proxyCounter.set(ep, newCount)
		if (newCount === 0) {
			releaseEndpoint(ep)
		}
	})

function registerProxy(proxy: object, ep: Endpoint) {
	const newCount = (proxyCounter.get(ep) || 0) + 1
	proxyCounter.set(ep, newCount)
	if (proxyFinalizers) {
		proxyFinalizers.register(proxy, ep, proxy)
	}
}

function unregisterProxy(proxy: object) {
	if (proxyFinalizers) {
		proxyFinalizers.unregister(proxy)
	}
}

function createProxy<T>(
	ep: Endpoint,
	pendingListeners: PendingListenersMap,
	path: (string | number | symbol)[] = [],
	target: object = function () {}
): Remote<T> {
	let isProxyReleased = false
	const proxy = new Proxy(target, {
		get(_target, prop) {
			throwIfProxyReleased(isProxyReleased)
			if (prop === releaseProxy) {
				return () => {
					unregisterProxy(proxy)
					releaseEndpoint(ep)
					pendingListeners.clear()
					isProxyReleased = true
				}
			}
			if (prop === 'then') {
				if (path.length === 0) {
					return { then: () => proxy }
				}
				const r = requestResponseMessage(ep, pendingListeners, {
					type: MessageType.GET,
					path: path.map((p) => p.toString()),
				}).then(fromWireValue)
				return r.then.bind(r)
			}
			return createProxy(ep, pendingListeners, [...path, prop])
		},
		set(_target, prop, rawValue) {
			throwIfProxyReleased(isProxyReleased)
			// FIXME: ES6 Proxy Handler `set` methods are supposed to return a
			// boolean. To show good will, we return true asynchronously ¯\_(ツ)_/¯
			const [value, transferables] = toWireValue(rawValue)
			return requestResponseMessage(
				ep,
				pendingListeners,
				{
					type: MessageType.SET,
					path: [...path, prop].map((p) => p.toString()),
					value,
				},
				transferables
			).then(fromWireValue) as any
		},
		apply(_target, _thisArg, rawArgumentList) {
			throwIfProxyReleased(isProxyReleased)
			const last = path[path.length - 1]
			if ((last as any) === createEndpoint) {
				return requestResponseMessage(ep, pendingListeners, {
					type: MessageType.ENDPOINT,
				}).then(fromWireValue)
			}
			// We just pretend that `bind()` didn’t happen.
			if (last === 'bind') {
				return createProxy(ep, pendingListeners, path.slice(0, -1))
			}
			const [argumentList, transferables] =
				processArguments(rawArgumentList)
			return requestResponseMessage(
				ep,
				pendingListeners,
				{
					type: MessageType.APPLY,
					path: path.map((p) => p.toString()),
					argumentList,
				},
				transferables
			).then(fromWireValue)
		},
		construct(_target, rawArgumentList) {
			throwIfProxyReleased(isProxyReleased)
			const [argumentList, transferables] =
				processArguments(rawArgumentList)
			return requestResponseMessage(
				ep,
				pendingListeners,
				{
					type: MessageType.CONSTRUCT,
					path: path.map((p) => p.toString()),
					argumentList,
				},
				transferables
			).then(fromWireValue)
		},
	})
	registerProxy(proxy, ep)
	return proxy as any
}

function myFlat<T>(arr: (T | T[])[]): T[] {
	return Array.prototype.concat.apply([], arr)
}

function processArguments(argumentList: any[]): [WireValue[], Transferable[]] {
	const processed = argumentList.map(toWireValue)
	return [processed.map((v) => v[0]), myFlat(processed.map((v) => v[1]))]
}

const transferCache = new WeakMap<any, Transferable[]>()
export function transfer<T>(obj: T, transfers: Transferable[]): T {
	transferCache.set(obj, transfers)
	return obj
}

export function proxy<T extends object>(obj: T): T & ProxyMarked {
	return Object.assign(obj, { [proxyMarker]: true }) as any
}

export function windowEndpoint(
	w: PostMessageWithOrigin,
	context: EventSource = globalThis,
	targetOrigin = '*'
): Endpoint {
	return {
		postMessage: (msg: any, transferables: Transferable[]) =>
			w.postMessage(msg, targetOrigin, transferables),
		addEventListener: context.addEventListener.bind(context),
		removeEventListener: context.removeEventListener.bind(context),
	}
}

function toWireValue(value: any): [WireValue, Transferable[]] {
	for (const [name, handler] of transferHandlers) {
		if (handler.canHandle(value)) {
			const [serializedValue, transferables] = handler.serialize(value)
			return [
				{
					type: WireValueType.HANDLER,
					name,
					value: serializedValue,
				},
				transferables,
			]
		}
	}
	return [
		{
			type: WireValueType.RAW,
			value,
		},
		transferCache.get(value) || [],
	]
}

function fromWireValue(value: WireValue): any {
	switch (value.type) {
		case WireValueType.HANDLER:
			return transferHandlers.get(value.name)!.deserialize(value.value)
		case WireValueType.RAW:
			return value.value
	}
}

function requestResponseMessage(
	ep: Endpoint,
	pendingListeners: PendingListenersMap,
	msg: Message,
	transfers?: Transferable[]
): Promise<WireValue> {
	return new Promise((resolve) => {
		const id = generateUUID()
		pendingListeners.set(id, resolve)
		if (ep.start) {
			ep.start()
		}
		ep.postMessage({ id, ...msg }, transfers)
	})
}

function generateUUID(): string {
	return new Array(4)
		.fill(0)
		.map(() =>
			Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)
		)
		.join('-')
}

// node-adapter.ts:

export interface NodeEndpoint {
	postMessage(message: any, transfer?: any[]): void
	on(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: object
	): void
	off(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: object
	): void
	start?: () => void
}

export function nodeEndpoint(nep: NodeEndpoint): Endpoint {
	const listeners = new WeakMap()
	return {
		postMessage: nep.postMessage.bind(nep),
		addEventListener: (_, eh) => {
			const l = (data: any) => {
				if ('handleEvent' in eh) {
					eh.handleEvent({ data } as MessageEvent)
				} else {
					eh({ data } as MessageEvent)
				}
			}
			nep.on('message', l)
			listeners.set(eh, l)
		},
		removeEventListener: (_, eh) => {
			const l = listeners.get(eh)
			if (!l) {
				return
			}
			nep.off('message', l)
			listeners.delete(eh)
		},
		start: nep.start && nep.start.bind(nep),
	}
}
