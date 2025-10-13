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
import { decodeSpawnSyncResponse } from './spawn-sync-serialization.ts'

export interface SpawnSyncOutcome {
	status: number | null
	stdout?: string
	stderr?: string
	error?: string
}

export interface SpawnSyncClient {
	run(options: unknown): SpawnSyncOutcome
	dispose(): void
}

export const createSpawnSyncClient = (
	port: MessagePort
): SpawnSyncClient => {
	const worker = new Worker(
		new URL('./spawn-sync-pump-worker.ts', import.meta.url),
		{ type: 'module', name: 'spawn-sync-pump' }
	)

	let disposed = false
	let nextRequestId = 1

	worker.postMessage({ type: 'init', port }, [port])

	const run = (options: unknown): SpawnSyncOutcome => {
		if (disposed) {
			throw new Error('spawnSync bridge has been disposed')
		}

		let bufferSize = SYNC_TOTAL_BYTES
		const MAX_BUFFER_BYTES = 16 * 1024 * 1024
		const requestId = nextRequestId++

		for (let attempt = 0; attempt < 6; attempt += 1) {
			const buffer = new SharedArrayBuffer(bufferSize)
			const header = new Int32Array(buffer, 0, SYNC_HEADER_INT_COUNT)

			try {
				worker.postMessage({
					type: 'syncRequest',
					requestId,
					options,
					buffer,
				})
			} catch (error) {
				throw error instanceof Error
					? error
					: new Error(String(error ?? 'spawnSync request failed'))
			}

			waitForSyncResult(header)
			const status = Atomics.load(header, SYNC_STATUS_INDEX)
			if (status === SYNC_STATUS_OVERFLOW) {
				const required = Atomics.load(header, SYNC_LENGTH_INDEX)
				const suggested =
					required > 0 ? SYNC_HEADER_BYTES + required + 1024 : bufferSize * 2
				if (suggested > MAX_BUFFER_BYTES) {
					throw new Error(
						`spawnSync response exceeded ${MAX_BUFFER_BYTES} bytes`
					)
				}
				bufferSize = Math.min(Math.max(bufferSize * 2, suggested), MAX_BUFFER_BYTES)
				continue
			}
			if (status !== SYNC_STATUS_READY) {
				throw new Error(`Unexpected spawnSync status: ${status}`)
			}

			const length = Atomics.load(header, SYNC_LENGTH_INDEX)
			if (length <= 0) {
				throw new Error('Empty spawnSync response payload')
			}
			const payload = new Uint8Array(
				buffer,
				SYNC_HEADER_BYTES,
				length
			).slice()
			const decoded = decodeSpawnSyncResponse(payload)
			if (!decoded.ok) {
				return {
					status: null,
					error: decoded.error?.message ?? 'spawnSync failed',
				}
			}
			return decoded.result ?? { status: null }
		}

		throw new Error('spawnSync response exceeded retry budget')
	}

	const dispose = () => {
		if (disposed) {
			return
		}
		disposed = true
		try {
			worker.postMessage({ type: 'dispose' })
		} catch {
			// ignore
		}
		worker.terminate()
	}

	return {
		run,
		dispose,
	}
}

const waitForSyncResult = (header: Int32Array) => {
	let status = Atomics.load(header, SYNC_STATUS_INDEX)
	while (status === SYNC_STATUS_PENDING) {
		Atomics.wait(header, SYNC_STATUS_INDEX, SYNC_STATUS_PENDING)
		status = Atomics.load(header, SYNC_STATUS_INDEX)
	}
}
