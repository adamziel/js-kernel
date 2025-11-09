import {
	CONTROL_MESSAGE_FS_REQUEST,
	CONTROL_MESSAGE_FS_RESPONSE,
	CONTROL_MESSAGE_SPAWN_SYNC_REQUEST,
	CONTROL_MESSAGE_SPAWN_SYNC_RESPONSE,
} from '../../process/constants.ts';
import {
	encodeSerializedResponse,
	serializeFsError,
	type SerializedFsResponse,
} from '../../fs/serialization.ts';
import {
	encodeSpawnSyncResponse,
	type SerializedSpawnSyncResponse,
} from '../../process/spawn-sync/serialization.ts';
import {
	SYNC_HEADER_BYTES,
	SYNC_HEADER_INT_COUNT,
	SYNC_LENGTH_INDEX,
	SYNC_STATUS_INDEX,
	SYNC_STATUS_OVERFLOW,
	SYNC_STATUS_PENDING,
	SYNC_STATUS_READY,
} from './shared-buffer.ts';

type ChannelKind = 'fs' | 'spawnSync';

type PendingFsRequest =
	| {
			kind: 'async';
	  }
	| {
			kind: 'sync';
			buffer: SharedArrayBuffer;
	  };

interface PendingSpawnSyncRequest {
	buffer: SharedArrayBuffer;
}

let channelKind: ChannelKind | null = null;
let kernelPort: MessagePort | null = null;

const pendingFsRequests = new Map<number, PendingFsRequest>();
const pendingSpawnRequests = new Map<number, PendingSpawnSyncRequest>();
const spawnOverflowResponses = new Map<number, Uint8Array>();

const handleKernelMessage = (event: MessageEvent) => {
	const payload = event.data;
	if (!payload || typeof payload !== 'object' || !channelKind) {
		return;
	}

	if (channelKind === 'fs') {
		handleFsKernelMessage(payload);
	} else if (channelKind === 'spawnSync') {
		handleSpawnKernelMessage(payload);
	}
};

const handleFsKernelMessage = (payload: any) => {
	if (payload.type !== CONTROL_MESSAGE_FS_RESPONSE) {
		return;
	}

	const requestId = payload.requestId;
	//console.error(`[pump-worker] Received FS response #${requestId}`);
	if (typeof requestId !== 'number') {
		return;
	}

	const pending = pendingFsRequests.get(requestId);
	if (!pending) {
		//console.error(`[pump-worker] No pending request found for #${requestId}`);
		return;
	}
	pendingFsRequests.delete(requestId);

	const response: SerializedFsResponse | undefined = payload.response;
	if (pending.kind === 'async') {
		//console.error(`[pump-worker] Posting async response #${requestId} to client`);
		self.postMessage({
			type: 'asyncResponse',
			requestId,
			response,
		});
		return;
	}

	if (!response) {
		//console.error(`[pump-worker] No response payload for sync request #${requestId}`);
		writeFsError(
			pending.buffer,
			new Error('Missing filesystem response payload')
		);
		return;
	}

	//console.error(`[pump-worker] Writing sync response #${requestId} to SharedArrayBuffer`);
	writeFsResponse(pending.buffer, response);
	//console.error(`[pump-worker] Completed sync response #${requestId}`);
};

const handleSpawnKernelMessage = (payload: any) => {
	if (payload.type !== CONTROL_MESSAGE_SPAWN_SYNC_RESPONSE) {
		return;
	}

	const requestId = payload.requestId;
	if (typeof requestId !== 'number') {
		return;
	}

	const pending = pendingSpawnRequests.get(requestId);
	if (!pending) {
		return;
	}
	pendingSpawnRequests.delete(requestId);

	const response: SerializedSpawnSyncResponse | undefined = payload.response;
	if (!response) {
		writeSpawnSyncResponse(pending.buffer, {
			ok: false,
			error: { message: 'Missing spawn result payload' },
		});
		return;
	}

	const encoded = encodeSpawnSyncResponse(response);
	const written = writeEncodedResponseToBuffer(pending.buffer, encoded);
	if (!written) {
		spawnOverflowResponses.set(requestId, encoded);
	}
};

self.addEventListener('message', (event: MessageEvent) => {
	const payload = event.data;
	if (!payload || typeof payload !== 'object') {
		return;
	}

	switch (payload.type) {
		case 'init': {
			initializeChannel(payload);
			break;
		}
		case 'dispose': {
			disposeChannel();
			break;
		}
		default: {
			dispatchClientMessage(payload);
		}
	}
});

const initializeChannel = (payload: any) => {
	const port = payload.port;
	if (!(port instanceof MessagePort)) {
		throw new Error('sync pump worker requires a MessagePort');
	}

	const kind: ChannelKind =
		payload.channel === 'spawnSync' ? 'spawnSync' : 'fs';

	if (kernelPort) {
		cleanupKernelPort();
	}
	clearChannelState();

	channelKind = kind;
	kernelPort = port;
	kernelPort.addEventListener('message', handleKernelMessage);
	if (typeof kernelPort.start === 'function') {
		kernelPort.start();
	}
};

const dispatchClientMessage = (payload: any) => {
	if (!channelKind) {
		throw new Error('sync pump worker not yet initialized');
	}

	if (channelKind === 'fs') {
		handleFsClientMessage(payload);
	} else if (channelKind === 'spawnSync') {
		handleSpawnClientMessage(payload);
	}
};

const handleFsClientMessage = (payload: any) => {
	switch (payload.type) {
		case 'asyncRequest': {
			dispatchFsRequest(payload.requestId, payload.method, payload.args, {
				kind: 'async',
			});
			break;
		}
		case 'syncRequest': {
			const buffer = payload.buffer;
			if (!(buffer instanceof SharedArrayBuffer)) {
				throw new Error(
					'Filesystem syncRequest requires SharedArrayBuffer'
				);
			}
			resetSyncBuffer(buffer);
			dispatchFsRequest(payload.requestId, payload.method, payload.args, {
				kind: 'sync',
				buffer,
			});
			break;
		}
		default:
			break;
	}
};

const dispatchFsRequest = (
	requestId: unknown,
	method: unknown,
	args: unknown,
	record: PendingFsRequest
) => {
	if (typeof requestId !== 'number') {
		throw new TypeError('Filesystem request requires numeric requestId');
	}
	if (typeof method !== 'string' || !method) {
		throw new TypeError('Filesystem request requires method name');
	}

	const argumentList = Array.isArray(args) ? args : [];

	if (!kernelPort) {
		throw new Error('Filesystem bridge is not initialized');
	}

	//console.error(`[pump-worker] Dispatching FS request #${requestId}: ${method}(${JSON.stringify(argumentList).slice(0, 100)})`);

	pendingFsRequests.set(requestId, record);

	kernelPort.postMessage({
		type: CONTROL_MESSAGE_FS_REQUEST,
		requestId,
		method,
		args: argumentList,
	});

	//console.error(`[pump-worker] Posted FS request #${requestId} to kernelPort`);
};

const handleSpawnClientMessage = (payload: any) => {
	if (payload.type !== 'syncRequest') {
		return;
	}

	const { requestId, options, buffer } = payload;
	if (typeof requestId !== 'number') {
		throw new Error('spawnSync: requestId must be a number');
	}
	if (!(buffer instanceof SharedArrayBuffer)) {
		throw new Error('spawnSync: buffer must be SharedArrayBuffer');
	}

	resetSyncBuffer(buffer);

	const cached = spawnOverflowResponses.get(requestId);
	if (cached) {
		spawnOverflowResponses.delete(requestId);
		const written = writeEncodedResponseToBuffer(buffer, cached);
		if (!written) {
			spawnOverflowResponses.set(requestId, cached);
		}
		return;
	}

	if (!kernelPort) {
		throw new Error('spawnSync: kernel port not initialized');
	}

	pendingSpawnRequests.set(requestId, { buffer });
	kernelPort.postMessage({
		type: CONTROL_MESSAGE_SPAWN_SYNC_REQUEST,
		requestId,
		options,
	});
};

const disposeChannel = () => {
	if (channelKind === 'fs') {
		disposeFsChannel();
	} else if (channelKind === 'spawnSync') {
		disposeSpawnChannel();
	}

	clearChannelState();
	cleanupKernelPort();
	channelKind = null;
};

const disposeFsChannel = () => {
	for (const [requestId, pending] of pendingFsRequests.entries()) {
		if (pending.kind === 'sync') {
			writeFsError(
				pending.buffer,
				new Error('Filesystem bridge disposed')
			);
		} else {
			self.postMessage({
				type: 'asyncResponse',
				requestId,
				response: serializeFsError(
					new Error('Filesystem bridge disposed')
				),
			});
		}
	}
	pendingFsRequests.clear();
};

const disposeSpawnChannel = () => {
	for (const pending of pendingSpawnRequests.values()) {
		writeSpawnSyncResponse(pending.buffer, {
			ok: false,
			error: { message: 'spawnSync worker disposed' },
		});
	}
	pendingSpawnRequests.clear();
	spawnOverflowResponses.clear();
};

const clearChannelState = () => {
	pendingFsRequests.clear();
	pendingSpawnRequests.clear();
	spawnOverflowResponses.clear();
};

const cleanupKernelPort = () => {
	if (!kernelPort) {
		return;
	}
	kernelPort.removeEventListener('message', handleKernelMessage);
	try {
		kernelPort.close();
	} catch {
		// ignore
	}
	kernelPort = null;
};

const resetSyncBuffer = (buffer: SharedArrayBuffer) => {
	const header = new Int32Array(buffer, 0, SYNC_HEADER_INT_COUNT);
	Atomics.store(header, SYNC_STATUS_INDEX, SYNC_STATUS_PENDING);
	Atomics.store(header, SYNC_LENGTH_INDEX, 0);
};

const writeEncodedResponseToBuffer = (
	buffer: SharedArrayBuffer,
	encoded: Uint8Array
) => {
	const header = new Int32Array(buffer, 0, SYNC_HEADER_INT_COUNT);
	const payload = new Uint8Array(buffer, SYNC_HEADER_BYTES);
	if (encoded.length > payload.length) {
		Atomics.store(header, SYNC_LENGTH_INDEX, encoded.length);
		Atomics.store(header, SYNC_STATUS_INDEX, SYNC_STATUS_OVERFLOW);
		Atomics.notify(header, SYNC_STATUS_INDEX, 1);
		return false;
	}
	payload.set(encoded);
	Atomics.store(header, SYNC_LENGTH_INDEX, encoded.length);
	Atomics.store(header, SYNC_STATUS_INDEX, SYNC_STATUS_READY);
	Atomics.notify(header, SYNC_STATUS_INDEX, 1);
	return true;
};

const writeFsResponse = (
	buffer: SharedArrayBuffer,
	response: SerializedFsResponse
) => {
	const encoded = encodeSerializedResponse(response);
	writeEncodedResponseToBuffer(buffer, encoded);
};

const writeFsError = (buffer: SharedArrayBuffer, error: Error) => {
	writeFsResponse(buffer, {
		ok: false,
		error: {
			message: error.message,
			name: error.name,
			stack: error.stack,
		},
	});
};

const writeSpawnSyncResponse = (
	buffer: SharedArrayBuffer,
	response: SerializedSpawnSyncResponse
) => {
	const encoded = encodeSpawnSyncResponse(response);
	writeEncodedResponseToBuffer(buffer, encoded);
};
