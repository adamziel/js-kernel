export interface SpawnSyncRequest {
	options: unknown
}

export interface SpawnSyncResult {
	status: number | null
	stdout?: string
	stderr?: string
	error?: string
}

export interface SerializedSpawnSyncResponse {
	ok: boolean
	result?: SpawnSyncResult
	error?: { message: string }
}

export const encodeSpawnSyncResponse = (
	response: SerializedSpawnSyncResponse
): Uint8Array => {
	const textEncoder = new TextEncoder()
	return textEncoder.encode(JSON.stringify(response))
}

export const decodeSpawnSyncResponse = (
	bytes: Uint8Array
): SerializedSpawnSyncResponse => {
	const textDecoder = new TextDecoder()
	return JSON.parse(textDecoder.decode(bytes))
}
