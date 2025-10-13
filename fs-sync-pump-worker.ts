import {
	CONTROL_MESSAGE_FS_REQUEST,
	CONTROL_MESSAGE_FS_RESPONSE,
} from './process-constants.ts'
import {
	SerializedFsResponse,
	encodeSerializedResponse,
	serializeFsError,
} from './fs-serialization.ts'
import {
	SYNC_HEADER_BYTES,
	SYNC_HEADER_INT_COUNT,
	SYNC_LENGTH_INDEX,
	SYNC_STATUS_INDEX,
	SYNC_STATUS_OVERFLOW,
	SYNC_STATUS_PENDING,
	SYNC_STATUS_READY,
} from './fs-sync-shared.ts'

type PendingRequest =
	| {
			kind: 'async'
	  }
	| {
			kind: 'sync'
			buffer: SharedArrayBuffer
	  }

let kernelPort: MessagePort | null = null
const pendingRequests = new Map<number, PendingRequest>()

const handleKernelResponse = (event: MessageEvent) => {
	const payload = event.data
	if (!payload || typeof payload !== 'object') {
		return
	}
	if (payload.type !== CONTROL_MESSAGE_FS_RESPONSE) {
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

	const response: SerializedFsResponse | undefined = payload.response

	if (pending.kind === 'async') {
		self.postMessage({
			type: 'asyncResponse',
			requestId,
			response,
		})
		return
	}

	if (pending.kind === 'sync') {
		if (!response) {
			writeSyncError(
				pending.buffer,
				new Error('Missing filesystem response payload')
			)
			return
		}
		writeSyncResponse(pending.buffer, response)
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
				throw new Error('fs-sync pump worker requires a MessagePort')
			}

			kernelPort = port
			kernelPort.addEventListener(
				'message',
				handleKernelResponse
			)
			if (typeof kernelPort.start === 'function') {
				kernelPort.start()
			}
			break
		}
		case 'asyncRequest': {
			dispatchRequest(payload.requestId, payload.method, payload.args, {
				kind: 'async',
			})
			break
		}
		case 'syncRequest': {
			const buffer = payload.buffer
			if (!(buffer instanceof SharedArrayBuffer)) {
				throw new Error('syncRequest requires SharedArrayBuffer buffer')
			}
			resetSyncBuffer(buffer)
			dispatchRequest(payload.requestId, payload.method, payload.args, {
				kind: 'sync',
				buffer,
			})
			break
		}
		case 'dispose': {
			cleanup()
			break
		}
		default:
			break
	}
})

const dispatchRequest = (
	requestId: unknown,
	method: unknown,
	args: unknown,
	record: PendingRequest
) => {
	if (typeof requestId !== 'number') {
		throw new TypeError('Filesystem request requires a numeric requestId')
	}
	if (typeof method !== 'string' || !method) {
		throw new TypeError('Filesystem request requires a method name')
	}
	const argumentList = Array.isArray(args) ? args : []

	if (!kernelPort) {
		throw new Error('Filesystem bridge is not initialized')
	}

	pendingRequests.set(requestId, record)

	kernelPort.postMessage({
		type: CONTROL_MESSAGE_FS_REQUEST,
		requestId,
		method,
		args: argumentList,
	})
}

const resetSyncBuffer = (buffer: SharedArrayBuffer) => {
	const header = new Int32Array(buffer, 0, SYNC_HEADER_INT_COUNT)
	Atomics.store(header, SYNC_STATUS_INDEX, SYNC_STATUS_PENDING)
	Atomics.store(header, SYNC_LENGTH_INDEX, 0)
}

const writeSyncResponse = (
	buffer: SharedArrayBuffer,
	response: SerializedFsResponse
) => {
	const header = new Int32Array(buffer, 0, SYNC_HEADER_INT_COUNT)
	const payload = new Uint8Array(buffer, SYNC_HEADER_BYTES)
	const encoded = encodeSerializedResponse(response)
	if (encoded.length > payload.length) {
		Atomics.store(header, SYNC_LENGTH_INDEX, encoded.length)
		Atomics.store(header, SYNC_STATUS_INDEX, SYNC_STATUS_OVERFLOW)
		Atomics.notify(header, SYNC_STATUS_INDEX, 1)
		return
	}
	payload.set(encoded)
	Atomics.store(header, SYNC_LENGTH_INDEX, encoded.length)
	Atomics.store(header, SYNC_STATUS_INDEX, SYNC_STATUS_READY)
	Atomics.notify(header, SYNC_STATUS_INDEX, 1)
}

const writeSyncError = (buffer: SharedArrayBuffer, error: Error) => {
	writeSyncResponse(buffer, {
		ok: false,
		error: {
			message: error.message,
			name: error.name,
			stack: error.stack,
		},
	})
}

const cleanup = () => {
	for (const [requestId, pending] of pendingRequests.entries()) {
		if (pending.kind === 'sync') {
			writeSyncError(
				pending.buffer,
				new Error('Filesystem bridge disposed')
			)
		} else {
			self.postMessage({
				type: 'asyncResponse',
				requestId,
				response: serializeFsError(
					new Error('Filesystem bridge disposed')
				),
			})
		}
	}
	pendingRequests.clear()
	if (kernelPort) {
		kernelPort.removeEventListener('message', handleKernelResponse)
		try {
			kernelPort.close()
		} catch {
			// ignore
		}
		kernelPort = null
	}
}
