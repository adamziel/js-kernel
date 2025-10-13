import { Dirent, Stats } from './in-memory/nodes.ts'

export type SerializedFsValue =
	| { type: 'undefined' }
	| { type: 'null' }
	| { type: 'boolean'; value: boolean }
	| { type: 'number'; value: number }
	| { type: 'string'; value: string }
	| { type: 'bigint'; value: string }
	| { type: 'uint8array'; value: number[] }
	| { type: 'array'; value: SerializedFsValue[] }
	| { type: 'object'; value: Record<string, SerializedFsValue> }
	| { type: 'stats'; value: SerializedStatsShape }
	| { type: 'dirent'; value: { name: string; type: string } }

interface SerializedStatsShape {
	type: string
	mode: number
	size: number
	atimeMs: number
	mtimeMs: number
	ctimeMs: number
	birthtimeMs: number
}

export interface SerializedFsError {
	message: string
	name?: string
	code?: string | number
	stack?: string
}

export interface SerializedFsResponse {
	ok: boolean
	value?: SerializedFsValue
	error?: SerializedFsError
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const serializeFsResponse = (
	value: unknown
): SerializedFsResponse => ({
	ok: true,
	value: serializeFsValue(value, new WeakSet()),
})

export const serializeFsError = (
	error: unknown
): SerializedFsResponse => ({
	ok: false,
	error: serializeError(error),
})

export const serializeError = (error: unknown): SerializedFsError => {
	if (error instanceof Error) {
		const serialized: SerializedFsError = {
			message: error.message,
			name: error.name,
			stack: error.stack,
		}
		const code = (error as any).code
		if (typeof code === 'string' || typeof code === 'number') {
			serialized.code = code
		}
		return serialized
	}
	return {
		message: typeof error === 'string' ? error : String(error),
		name: 'Error',
	}
}

function serializeFsValue(
	value: unknown,
	seen: WeakSet<object>
): SerializedFsValue {
	if (value === undefined) {
		return { type: 'undefined' }
	}
	if (value === null) {
		return { type: 'null' }
	}
	const valueType = typeof value
	if (valueType === 'boolean') {
		return { type: 'boolean', value: value as boolean }
	}
	if (valueType === 'number') {
		return { type: 'number', value: value as number }
	}
	if (valueType === 'string') {
		return { type: 'string', value: value as string }
	}
	if (valueType === 'bigint') {
		return { type: 'bigint', value: (value as bigint).toString(10) }
	}

	if (value instanceof Uint8Array) {
		return { type: 'uint8array', value: Array.from(value) }
	}
	if (value instanceof ArrayBuffer) {
		return {
			type: 'uint8array',
			value: Array.from(new Uint8Array(value)),
		}
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView
		return {
			type: 'uint8array',
			value: Array.from(
				new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
			),
		}
	}

	if (value instanceof Stats) {
		return {
			type: 'stats',
			value: serializeStats(value),
		}
	}
	if (value instanceof Dirent) {
		return {
			type: 'dirent',
			value: {
				name: value.name,
				type: value.type,
			},
		}
	}

	if (Array.isArray(value)) {
		if (seen.has(value)) {
			throw new TypeError('Cannot serialize circular array structure')
		}
		seen.add(value)
		return {
			type: 'array',
			value: value.map((entry) => serializeFsValue(entry, seen)),
		}
	}

	if (valueType === 'object') {
		const objectValue = value as Record<string, unknown>
		if (seen.has(objectValue)) {
			throw new TypeError('Cannot serialize circular object structure')
		}
		seen.add(objectValue)
		const result: Record<string, SerializedFsValue> = {}
		for (const [key, entry] of Object.entries(objectValue)) {
			result[key] = serializeFsValue(entry, seen)
		}
		return {
			type: 'object',
			value: result,
		}
	}

	// Fallback – convert to string
	return { type: 'string', value: String(value) }
}

const serializeStats = (stats: Stats): SerializedStatsShape => ({
	type: stats.type,
	mode: stats.mode,
	size: stats.size,
	atimeMs: stats.atimeMs,
	mtimeMs: stats.mtimeMs,
	ctimeMs: stats.ctimeMs,
	birthtimeMs: stats.birthtimeMs,
})

export const deserializeFsResponse = (
	response: SerializedFsResponse
):
	| { ok: true; value: unknown }
	| { ok: false; error: Error & { code?: string | number } } => {
	if (response.ok) {
		return {
			ok: true,
			value: deserializeFsValue(response.value),
		}
	}

	const error = deserializeFsError(response.error)
	return { ok: false, error }
}

export const deserializeFsValue = (
	value: SerializedFsValue | undefined
): unknown => {
	if (!value) {
		return undefined
	}
	switch (value.type) {
		case 'undefined':
			return undefined
		case 'null':
			return null
		case 'boolean':
			return value.value
		case 'number':
			return value.value
		case 'string':
			return value.value
		case 'bigint':
			return BigInt(value.value)
		case 'uint8array':
			return new Uint8Array(value.value)
		case 'dirent':
			return hydrateDirent(value.value)
		case 'stats':
			return hydrateStats(value.value)
		case 'array':
			return value.value.map((entry) => deserializeFsValue(entry))
		case 'object': {
			const result: Record<string, unknown> = {}
			for (const [key, entry] of Object.entries(value.value)) {
				result[key] = deserializeFsValue(entry)
			}
			return result
		}
		default:
			return undefined
	}
}

export const deserializeFsError = (
	value: SerializedFsError | undefined
): Error & { code?: string | number } => {
	const error = new Error(value?.message ?? 'Unknown filesystem error')
	if (value?.name) {
		error.name = value.name
	}
	if (value?.stack) {
		error.stack = value.stack
	}
	if (value?.code) {
		;(error as any).code = value.code
	}
	return error as Error & { code?: string | number }
}

export const encodeSerializedResponse = (
	response: SerializedFsResponse
): Uint8Array => textEncoder.encode(JSON.stringify(response))

export const decodeSerializedResponse = (
	bytes: Uint8Array
): SerializedFsResponse => JSON.parse(textDecoder.decode(bytes))

function hydrateStats(shape: SerializedStatsShape): Stats {
	const stats: Stats = Object.create(Stats.prototype)
	stats.type = shape.type
	stats.mode = shape.mode
	stats.size = shape.size
	stats.atimeMs = shape.atimeMs
	stats.mtimeMs = shape.mtimeMs
	stats.ctimeMs = shape.ctimeMs
	stats.birthtimeMs = shape.birthtimeMs
	stats.atime = new Date(shape.atimeMs)
	stats.mtime = new Date(shape.mtimeMs)
	stats.ctime = new Date(shape.ctimeMs)
	stats.birthtime = new Date(shape.birthtimeMs)
	return stats
}

function hydrateDirent(data: { name: string; type: string }): Dirent {
	const dirent: Dirent = Object.create(Dirent.prototype)
	dirent.name = data.name
	dirent.type = data.type
	return dirent
}
