import {
	decodeSerializedResponse,
	deserializeFsResponse,
	type SerializedFsResponse,
} from './fs-serialization.ts'
import {
	SYNC_HEADER_BYTES,
	SYNC_HEADER_INT_COUNT,
	SYNC_LENGTH_INDEX,
	SYNC_STATUS_INDEX,
	SYNC_STATUS_OVERFLOW,
	SYNC_STATUS_PENDING,
	SYNC_STATUS_READY,
	SYNC_TOTAL_BYTES,
} from './fs-sync-shared.ts'

type AsyncResolver = {
	resolve(value: unknown): void
	reject(reason: unknown): void
}

export interface KernelFsClient {
	async: Record<string, (...args: unknown[]) => Promise<unknown>>
	sync: Record<string, (...args: unknown[]) => unknown>
	dispose(): void
}

export const createKernelFsClient = (
	fsPort: MessagePort
): KernelFsClient => {
	const pumpWorker = new Worker(
		new URL('./fs-sync-pump-worker.ts', import.meta.url),
		{ type: 'module', name: 'fs-sync-pump' }
	)

	let disposed = false
	let nextRequestId = 1
	const pendingAsync = new Map<number, AsyncResolver>()

	const handlePumpMessage = (event: MessageEvent) => {
		const payload = event.data
		if (!payload || typeof payload !== 'object') {
			return
		}
		if (payload.type !== 'asyncResponse') {
			return
		}

		const requestId = payload.requestId
		const response: SerializedFsResponse | undefined =
			payload.response

		if (typeof requestId !== 'number') {
			return
		}

		const resolver = pendingAsync.get(requestId)
		if (!resolver) {
			return
		}
		pendingAsync.delete(requestId)

		if (!response) {
			resolver.reject(new Error('Missing filesystem response'))
			return
		}
		const materialized = deserializeFsResponse(response)
		if (materialized.ok) {
			resolver.resolve(materialized.value)
		} else {
			resolver.reject(materialized.error)
		}
	}

	pumpWorker.addEventListener('message', handlePumpMessage)
	pumpWorker.postMessage(
		{
			type: 'init',
			port: fsPort,
		},
		[fsPort]
	)

	const requestAsync = (
		method: string,
		args: unknown[]
	): Promise<unknown> => {
		if (disposed) {
			return Promise.reject(
				new Error('Filesystem bridge has been disposed')
			)
		}
		const requestId = nextRequestId++
		return new Promise<unknown>((resolve, reject) => {
			pendingAsync.set(requestId, { resolve, reject })
			try {
				pumpWorker.postMessage({
					type: 'asyncRequest',
					requestId,
					method,
					args,
				})
			} catch (error) {
				pendingAsync.delete(requestId)
				reject(
					error instanceof Error
						? error
						: new Error(String(error ?? 'Async request failed'))
				)
			}
		})
	}

	const requestSync = (method: string, args: unknown[]): unknown => {
		if (disposed) {
			throw new Error('Filesystem bridge has been disposed')
		}

		const normalizedArgs = Array.isArray(args) ? [...args] : []
		let bufferBytes = SYNC_TOTAL_BYTES
		const MAX_BUFFER_BYTES = 16 * 1024 * 1024

		for (let attempt = 0; attempt < 6; attempt += 1) {
			const buffer = new SharedArrayBuffer(bufferBytes)
			const header = new Int32Array(buffer, 0, SYNC_HEADER_INT_COUNT)
			const requestId = nextRequestId++

			try {
				pumpWorker.postMessage({
					type: 'syncRequest',
					requestId,
					method,
					args: normalizedArgs,
					buffer,
				})
			} catch (error) {
				throw error instanceof Error
					? error
					: new Error(String(error ?? 'Sync request failed'))
			}

			waitForSyncResult(header)

			const status = Atomics.load(header, SYNC_STATUS_INDEX)
			if (status === SYNC_STATUS_OVERFLOW) {
				const required = Atomics.load(header, SYNC_LENGTH_INDEX)
				const minimum =
					required > 0
						? SYNC_HEADER_BYTES + required
						: bufferBytes * 2
				const nextSize = Math.max(bufferBytes * 2, minimum + 1024)
				if (nextSize > MAX_BUFFER_BYTES) {
					throw new Error(
						`Synchronous filesystem response exceeded ${MAX_BUFFER_BYTES} bytes`
					)
				}
				bufferBytes = Math.min(nextSize, MAX_BUFFER_BYTES)
				continue
			}
			if (status !== SYNC_STATUS_READY) {
				throw new Error(
					`Unexpected synchronous filesystem status: ${status}`
				)
			}

			const length = Atomics.load(header, SYNC_LENGTH_INDEX)
			if (length <= 0) {
				throw new Error('Empty filesystem response payload')
			}
			const payload = new Uint8Array(buffer, SYNC_HEADER_BYTES, length)
			const response = decodeSerializedResponse(payload.slice())
			const materialized = deserializeFsResponse(response)
			if (materialized.ok) {
				return materialized.value
			}
			throw materialized.error
		}

		throw new Error(
			'Synchronous filesystem response exceeded retry budget'
		)
	}

	const asyncProxy = createMethodProxy(
		resolveKernelMethodName,
		(method, args) => requestAsync(method, args)
	)
	;(asyncProxy as any).promises = asyncProxy
	const syncProxy = createMethodProxy(
		resolveKernelMethodName,
		(method, args) => requestSync(method, args)
	)

	const dispose = () => {
		if (disposed) {
			return
		}
		disposed = true
		try {
			pumpWorker.postMessage({ type: 'dispose' })
		} catch {
			// ignore errors while disposing
		}
		pumpWorker.removeEventListener('message', handlePumpMessage)
		pumpWorker.terminate()
		for (const { reject } of pendingAsync.values()) {
			reject(new Error('Filesystem bridge disposed'))
		}
		pendingAsync.clear()
	}

	return {
		async: asyncProxy,
		sync: syncProxy,
		dispose,
	}
}

const createMethodProxy = <T>(
	resolveMethod: (method: string) => string | null,
	invoke: (method: string, args: unknown[]) => T
): Record<string, (...args: unknown[]) => T> => {
	const target = {} as Record<string, (...args: unknown[]) => T>
	return new Proxy(target, {
		get(currentTarget, property, receiver) {
			if (property === 'then') {
				return undefined
			}
			if (Reflect.has(currentTarget, property)) {
				return Reflect.get(currentTarget, property, receiver)
			}
			if (typeof property !== 'string') {
				return undefined
			}
			const kernelMethod = resolveMethod(property)
			if (!kernelMethod) {
				return undefined
			}
			return (...args: unknown[]) => invoke(kernelMethod, args)
		},
	})
}

const resolveKernelMethodName = (method: string): string => {
	if (method.endsWith('Sync') || method.endsWith('Async')) {
		return method
	}
	return `${method}Sync`
}

const waitForSyncResult = (header: Int32Array) => {
	let status = Atomics.load(header, SYNC_STATUS_INDEX)
	while (status === SYNC_STATUS_PENDING) {
		Atomics.wait(
			header,
			SYNC_STATUS_INDEX,
			SYNC_STATUS_PENDING
		)
		status = Atomics.load(header, SYNC_STATUS_INDEX)
	}
}
