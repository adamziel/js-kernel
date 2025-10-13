import {
	CONTROL_MESSAGE_SPAWN_SYNC_REQUEST,
	CONTROL_MESSAGE_SPAWN_SYNC_RESPONSE,
} from './process-constants.ts'
import {
	SYNC_HEADER_BYTES,
	SYNC_HEADER_INT_COUNT,
	SYNC_LENGTH_INDEX,
	SYNC_STATUS_INDEX,
	SYNC_STATUS_OVERFLOW,
	SYNC_STATUS_PENDING,
	SYNC_STATUS_READY,
} from './fs-sync-shared.ts'
import {
	encodeSpawnSyncResponse,
	type SerializedSpawnSyncResponse,
} from './spawn-sync-serialization.ts'

interface PendingSyncRequest {
	buffer: SharedArrayBuffer
}

let kernelPort: MessagePort | null = null
const pendingRequests = new Map<number, PendingSyncRequest>()
const overflowResponses = new Map<number, Uint8Array>()

const resetHeader = (buffer: SharedArrayBuffer) => {
	const header = new Int32Array(buffer, 0, SYNC_HEADER_INT_COUNT)
	Atomics.store(header, SYNC_STATUS_INDEX, SYNC_STATUS_PENDING)
	Atomics.store(header, SYNC_LENGTH_INDEX, 0)
}

const writeEncodedResponseToBuffer = (
	buffer: SharedArrayBuffer,
	encoded: Uint8Array
): boolean => {
	const header = new Int32Array(buffer, 0, SYNC_HEADER_INT_COUNT)
	const payload = new Uint8Array(buffer, SYNC_HEADER_BYTES)
	if (encoded.length > payload.length) {
		Atomics.store(header, SYNC_LENGTH_INDEX, encoded.length)
		Atomics.store(header, SYNC_STATUS_INDEX, SYNC_STATUS_OVERFLOW)
		Atomics.notify(header, SYNC_STATUS_INDEX, 1)
		return false
	}
	payload.set(encoded)
	Atomics.store(header, SYNC_LENGTH_INDEX, encoded.length)
	Atomics.store(header, SYNC_STATUS_INDEX, SYNC_STATUS_READY)
	Atomics.notify(header, SYNC_STATUS_INDEX, 1)
return true
}

const writeResponseToBuffer = (
	buffer: SharedArrayBuffer,
	response: SerializedSpawnSyncResponse
) => {
	const encoded = encodeSpawnSyncResponse(response)
	writeEncodedResponseToBuffer(buffer, encoded)
}

const handleKernelMessage = (event: MessageEvent) => {
	const payload = event.data
	if (!payload || typeof payload !== 'object') {
		return
	}
	if (payload.type !== CONTROL_MESSAGE_SPAWN_SYNC_RESPONSE) {
		return
	}
	const requestId = payload.requestId
	if (typeof requestId !== 'number') {
		return
	}

	const pending = pendingRequests.get(requestId)
	if (!pending) {
		return
	}
	pendingRequests.delete(requestId)

	const response: SerializedSpawnSyncResponse | undefined =
		payload.response
	if (!response) {
		writeResponseToBuffer(pending.buffer, {
			ok: false,
			error: { message: 'Missing spawn result payload' },
		})
		return
	}
	const encoded = encodeSpawnSyncResponse(response)
	const written = writeEncodedResponseToBuffer(pending.buffer, encoded)
	if (!written) {
		overflowResponses.set(requestId, encoded)
	}
}

self.addEventListener('message', (event: MessageEvent) => {
	const payload = event.data
	if (!payload || typeof payload !== 'object') {
		return
	}

	switch (payload.type) {
		case 'init': {
			const port = payload.port
			if (!(port instanceof MessagePort)) {
				throw new Error('spawn-sync pump worker requires MessagePort')
			}
			kernelPort = port
			kernelPort.addEventListener('message', handleKernelMessage)
			kernelPort.start()
			break
		}
	case 'syncRequest': {
		const { requestId, options, buffer } = payload
		if (typeof requestId !== 'number') {
			throw new Error('spawn-sync: requestId must be a number')
		}
		if (!(buffer instanceof SharedArrayBuffer)) {
			throw new Error('spawn-sync: buffer must be SharedArrayBuffer')
		}
		resetHeader(buffer)
		const cached = overflowResponses.get(requestId)
		if (cached) {
			overflowResponses.delete(requestId)
			const written = writeEncodedResponseToBuffer(buffer, cached)
			if (!written) {
				overflowResponses.set(requestId, cached)
			}
			break
		}
		if (!kernelPort) {
			throw new Error('spawn-sync: kernel port not initialized')
		}
		pendingRequests.set(requestId, { buffer })
		kernelPort.postMessage({
			type: CONTROL_MESSAGE_SPAWN_SYNC_REQUEST,
			requestId,
			options,
		})
		break
	}
	case 'dispose': {
		for (const pending of pendingRequests.values()) {
			writeResponseToBuffer(pending.buffer, {
				ok: false,
				error: { message: 'spawn-sync worker disposed' },
			})
		}
		pendingRequests.clear()
		overflowResponses.clear()
			if (kernelPort) {
				kernelPort.removeEventListener('message', handleKernelMessage)
				try {
					kernelPort.close()
				} catch {
					// ignore
				}
				kernelPort = null
			}
			break
		}
		default:
			break
	}
})
