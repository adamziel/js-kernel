import {
	SYNC_HEADER_BYTES,
	SYNC_HEADER_INT_COUNT,
	SYNC_LENGTH_INDEX,
	SYNC_STATUS_INDEX,
	SYNC_STATUS_OVERFLOW,
	SYNC_STATUS_PENDING,
	SYNC_STATUS_READY,
	SYNC_TOTAL_BYTES,
} from '../../ipc/sync/shared-buffer.ts'
import { decodeSpawnSyncResponse } from './serialization.ts'

export interface SpawnSyncOutcome {
	status: number | null
	stdout?: string
	stderr?: string
	error?: string
}

export interface SpawnSyncClient {
	run(options: unknown, timeoutMs?: number): SpawnSyncOutcome
	dispose(): void
}

export const createSpawnSyncClient = (
	port: MessagePort
): SpawnSyncClient => {
	const worker = new Worker(
		new URL('../../ipc/sync/pump-worker.ts', import.meta.url),
		{ type: 'module', name: 'sync-pump(spawn)' }
	)

	let disposed = false
	let nextRequestId = 1

	worker.postMessage({ type: 'init', channel: 'spawnSync', port }, [port])

	const run = (
		options: unknown,
		timeoutMs = 5000
	): SpawnSyncOutcome => {
		if (disposed) {
			throw new Error('spawnSync bridge has been disposed')
		}

		let bufferSize = SYNC_TOTAL_BYTES
		const MAX_BUFFER_BYTES = 16 * 1024 * 1024
		const requestId = nextRequestId++
		const effectiveTimeout =
			Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 5000
		const overallStart = Date.now()

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

			const elapsed = Date.now() - overallStart
			const remaining = Math.max(effectiveTimeout - elapsed, 0)
			if (
				remaining === 0 &&
				Atomics.load(header, SYNC_STATUS_INDEX) === SYNC_STATUS_PENDING
			) {
				throw new Error(
					`spawnSync timed out after ${effectiveTimeout}ms waiting for kernel response`
				)
			}

			waitForSyncResult(header, remaining)
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

const waitForSyncResult = (header: Int32Array, timeoutMs: number) => {
	const start = Date.now()

	for (;;) {
		const status = Atomics.load(header, SYNC_STATUS_INDEX)
		if (status !== SYNC_STATUS_PENDING) {
			return
		}
		const elapsed = Date.now() - start
		if (elapsed >= timeoutMs) {
			throw new Error(
				`spawnSync timed out after ${timeoutMs}ms waiting for kernel response`
			)
		}
		const remaining = Math.max(timeoutMs - elapsed, 0)
		const waitDuration = Math.min(remaining, 100)
		if (typeof Atomics.wait === 'function') {
			const result = Atomics.wait(
				header,
				SYNC_STATUS_INDEX,
				SYNC_STATUS_PENDING,
				waitDuration
			)
			if (result === 'not-equal' || result === 'ok') {
				continue
			}
		} else {
			const end = Date.now() + waitDuration
			while (
				Date.now() < end &&
				Atomics.load(header, SYNC_STATUS_INDEX) === SYNC_STATUS_PENDING
			) {
				// Busy wait for environments without Atomics.wait.
			}
		}
	}
}
