import { Dirent, Stats } from './in-memory/nodes.ts'

export type SerializedFsValue =
	| { type: 'undefined' }
	| { type: 'null' }
	| { type: 'boolean'; value: boolean }
	| { type: 'number'; value: number }
	| { type: 'string'; value: string }
	| { type: 'bigint'; value: string }
	| { type: 'uint8array'; value: Uint8Array }
	| { type: 'array'; value: SerializedFsValue[] }
	| { type: 'map'; value: [string, SerializedFsValue][] }
	| { type: 'set'; value: SerializedFsValue[] }
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

const serializeUint8Array = (value: Uint8Array): SerializedFsValue => ({
	type: 'uint8array',
	value: value.slice(),
})

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
		return serializeUint8Array(value)
	}
	if (value instanceof ArrayBuffer) {
		return serializeUint8Array(new Uint8Array(value))
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView
		return serializeUint8Array(
			new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
		)
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

	if (value instanceof Map) {
		const marker = value as unknown as object
		if (seen.has(marker)) {
			throw new TypeError('Cannot serialize circular Map structure')
		}
		seen.add(marker)
		return {
			type: 'map',
			value: Array.from(value.entries()).map(([key, entry]) => [
				String(key),
				serializeFsValue(entry, seen),
			]),
		}
	}
	if (value instanceof Set) {
		const marker = value as unknown as object
		if (seen.has(marker)) {
			throw new TypeError('Cannot serialize circular Set structure')
		}
		seen.add(marker)
		return {
			type: 'set',
			value: Array.from(value).map((entry) =>
				serializeFsValue(entry, seen)
			),
		}
	}

	if (valueType === 'object') {
		if ((value as object).constructor !== Object) {
			throw new TypeError(
				'Cannot serialize class instances or objects with custom prototypes'
			)
		}
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
			return value.value.slice()
		case 'dirent':
			return hydrateDirent(value.value)
		case 'stats':
			return hydrateStats(value.value)
		case 'array':
			return value.value.map((entry) => deserializeFsValue(entry))
		case 'map':
			return new Map(
				value.value.map(([key, entry]) => [
					key,
					deserializeFsValue(entry),
				])
			)
		case 'set':
			return new Set(value.value.map((entry) => deserializeFsValue(entry)))
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

const enum ResponseTag {
	Error = 0,
	Ok = 1,
}

const enum ValueTag {
	Undefined = 0,
	Null = 1,
	BooleanFalse = 2,
	BooleanTrue = 3,
	Number = 4,
	String = 5,
	BigInt = 6,
	Uint8Array = 7,
	Array = 8,
	Object = 9,
	Stats = 10,
	Dirent = 11,
	Map = 12,
	Set = 13,
}

const enum ErrorCodeTag {
	None = 0,
	String = 1,
	Number = 2,
}

class BinaryWriter {
	private buffer: Uint8Array
	private view: DataView
	private length = 0

	constructor(initialCapacity = 1024) {
		this.buffer = new Uint8Array(initialCapacity)
		this.view = new DataView(this.buffer.buffer)
	}

	private ensureCapacity(additional: number) {
		const required = this.length + additional
		if (required <= this.buffer.length) {
			return
		}
		let nextSize =
			this.buffer.length === 0 ? 1024 : this.buffer.length * 2
		while (nextSize < required) {
			nextSize *= 2
		}
		const next = new Uint8Array(nextSize)
		next.set(this.buffer, 0)
		this.buffer = next
		this.view = new DataView(this.buffer.buffer)
	}

	writeUint8(value: number) {
		this.ensureCapacity(1)
		this.buffer[this.length] = value & 0xff
		this.length += 1
	}

	writeBoolean(value: boolean) {
		this.writeUint8(value ? 1 : 0)
	}

	writeUint32(value: number) {
		this.ensureCapacity(4)
		this.view.setUint32(this.length, value >>> 0, true)
		this.length += 4
	}

	writeFloat64(value: number) {
		this.ensureCapacity(8)
		this.view.setFloat64(this.length, value, true)
		this.length += 8
	}

	writeBytes(bytes: Uint8Array) {
		this.ensureCapacity(bytes.byteLength)
		this.buffer.set(bytes, this.length)
		this.length += bytes.byteLength
	}

	writeString(value: string) {
		const encoded = textEncoder.encode(value)
		this.writeUint32(encoded.byteLength)
		this.writeBytes(encoded)
	}

	toUint8Array(): Uint8Array {
		return this.buffer.slice(0, this.length)
	}
}

class BinaryReader {
	private view: DataView
	private offset = 0

	constructor(private readonly buffer: Uint8Array) {
		this.view = new DataView(
			buffer.buffer,
			buffer.byteOffset,
			buffer.byteLength
		)
	}

	private ensureAvailable(bytes: number) {
		if (this.offset + bytes > this.buffer.byteLength) {
			throw new Error(
				'Unexpected end of synchronous filesystem response buffer'
			)
		}
	}

	readUint8(): number {
		this.ensureAvailable(1)
		const value = this.buffer[this.offset]
		this.offset += 1
		return value
	}

	readBoolean(): boolean {
		return this.readUint8() === 1
	}

	readUint32(): number {
		this.ensureAvailable(4)
		const value = this.view.getUint32(this.offset, true)
		this.offset += 4
		return value
	}

	readFloat64(): number {
		this.ensureAvailable(8)
		const value = this.view.getFloat64(this.offset, true)
		this.offset += 8
		return value
	}

	readBytes(length: number): Uint8Array {
		this.ensureAvailable(length)
		const slice = this.buffer.slice(this.offset, this.offset + length)
		this.offset += length
		return slice
	}

	readString(): string {
		const length = this.readUint32()
		if (length === 0) {
			return ''
		}
		const bytes = this.readBytes(length)
		return textDecoder.decode(bytes)
	}
}

const assertNever = (value: never): never => {
	throw new Error(`Unexpected serialized filesystem value: ${value}`)
}

const writeFsValue = (writer: BinaryWriter, value: SerializedFsValue) => {
	switch (value.type) {
		case 'undefined':
			writer.writeUint8(ValueTag.Undefined)
			return
		case 'null':
			writer.writeUint8(ValueTag.Null)
			return
		case 'boolean':
			writer.writeUint8(
				value.value ? ValueTag.BooleanTrue : ValueTag.BooleanFalse
			)
			return
		case 'number':
			writer.writeUint8(ValueTag.Number)
			writer.writeFloat64(value.value)
			return
		case 'string':
			writer.writeUint8(ValueTag.String)
			writer.writeString(value.value)
			return
		case 'bigint':
			writer.writeUint8(ValueTag.BigInt)
			writer.writeString(value.value)
			return
		case 'uint8array':
			writer.writeUint8(ValueTag.Uint8Array)
			writer.writeUint32(value.value.byteLength)
			writer.writeBytes(value.value)
			return
		case 'array':
			writer.writeUint8(ValueTag.Array)
			writer.writeUint32(value.value.length)
			for (const entry of value.value) {
				writeFsValue(writer, entry)
			}
			return
		case 'map':
			writer.writeUint8(ValueTag.Map)
			writer.writeUint32(value.value.length)
			for (const [key, entry] of value.value) {
				writer.writeString(key)
				writeFsValue(writer, entry)
			}
			return
		case 'set':
			writer.writeUint8(ValueTag.Set)
			writer.writeUint32(value.value.length)
			for (const entry of value.value) {
				writeFsValue(writer, entry)
			}
			return
		case 'object': {
			const entries = Object.entries(value.value)
			writer.writeUint8(ValueTag.Object)
			writer.writeUint32(entries.length)
			for (const [key, entry] of entries) {
				writer.writeString(key)
				writeFsValue(writer, entry)
			}
			return
		}
		case 'stats': {
			const stats = value.value
			writer.writeUint8(ValueTag.Stats)
			writer.writeString(stats.type)
			writer.writeFloat64(stats.mode)
			writer.writeFloat64(stats.size)
			writer.writeFloat64(stats.atimeMs)
			writer.writeFloat64(stats.mtimeMs)
			writer.writeFloat64(stats.ctimeMs)
			writer.writeFloat64(stats.birthtimeMs)
			return
		}
		case 'dirent':
			writer.writeUint8(ValueTag.Dirent)
			writer.writeString(value.value.name)
			writer.writeString(value.value.type)
			return
		default:
			assertNever(value)
	}
}

const writeFsError = (
	writer: BinaryWriter,
	error: SerializedFsError | undefined
) => {
	writer.writeString(error?.message ?? '')
	const hasName = typeof error?.name === 'string'
	writer.writeBoolean(hasName)
	if (hasName && error?.name) {
		writer.writeString(error.name)
	}
	const code = error?.code
	if (typeof code === 'string') {
		writer.writeUint8(ErrorCodeTag.String)
		writer.writeString(code)
	} else if (typeof code === 'number') {
		writer.writeUint8(ErrorCodeTag.Number)
		writer.writeFloat64(code)
	} else {
		writer.writeUint8(ErrorCodeTag.None)
	}
	const hasStack = typeof error?.stack === 'string'
	writer.writeBoolean(hasStack)
	if (hasStack && error?.stack) {
		writer.writeString(error.stack)
	}
}

const readFsValue = (reader: BinaryReader): SerializedFsValue => {
	const tag = reader.readUint8()
	switch (tag) {
		case ValueTag.Undefined:
			return { type: 'undefined' }
		case ValueTag.Null:
			return { type: 'null' }
		case ValueTag.BooleanFalse:
			return { type: 'boolean', value: false }
		case ValueTag.BooleanTrue:
			return { type: 'boolean', value: true }
		case ValueTag.Number:
			return { type: 'number', value: reader.readFloat64() }
		case ValueTag.String:
			return { type: 'string', value: reader.readString() }
		case ValueTag.BigInt:
			return { type: 'bigint', value: reader.readString() }
		case ValueTag.Uint8Array: {
			const length = reader.readUint32()
			const bytes =
				length === 0 ? new Uint8Array(0) : reader.readBytes(length)
			return { type: 'uint8array', value: bytes }
		}
		case ValueTag.Array: {
			const length = reader.readUint32()
			const entries: SerializedFsValue[] = new Array(length)
			for (let i = 0; i < length; i += 1) {
				entries[i] = readFsValue(reader)
			}
			return { type: 'array', value: entries }
		}
		case ValueTag.Map: {
			const length = reader.readUint32()
			const entries: [string, SerializedFsValue][] = new Array(length)
			for (let i = 0; i < length; i += 1) {
				const key = reader.readString()
				const entry = readFsValue(reader)
				entries[i] = [key, entry]
			}
			return { type: 'map', value: entries }
		}
		case ValueTag.Set: {
			const length = reader.readUint32()
			const entries: SerializedFsValue[] = new Array(length)
			for (let i = 0; i < length; i += 1) {
				entries[i] = readFsValue(reader)
			}
			return { type: 'set', value: entries }
		}
		case ValueTag.Object: {
			const length = reader.readUint32()
			const result: Record<string, SerializedFsValue> = {}
			for (let i = 0; i < length; i += 1) {
				const key = reader.readString()
				result[key] = readFsValue(reader)
			}
			return { type: 'object', value: result }
		}
		case ValueTag.Stats:
			return {
				type: 'stats',
				value: {
					type: reader.readString(),
					mode: reader.readFloat64(),
					size: reader.readFloat64(),
					atimeMs: reader.readFloat64(),
					mtimeMs: reader.readFloat64(),
					ctimeMs: reader.readFloat64(),
					birthtimeMs: reader.readFloat64(),
				},
			}
		case ValueTag.Dirent:
			return {
				type: 'dirent',
				value: {
					name: reader.readString(),
					type: reader.readString(),
				},
			}
		default:
			throw new Error(`Unknown filesystem value tag ${tag}`)
	}
}

const readFsError = (reader: BinaryReader): SerializedFsError => {
	const message = reader.readString()
	const hasName = reader.readBoolean()
	const name = hasName ? reader.readString() : undefined
	const codeTag = reader.readUint8()
	let code: string | number | undefined
	if (codeTag === ErrorCodeTag.String) {
		code = reader.readString()
	} else if (codeTag === ErrorCodeTag.Number) {
		code = reader.readFloat64()
	}
	const hasStack = reader.readBoolean()
	const stack = hasStack ? reader.readString() : undefined
	const error: SerializedFsError = { message }
	if (name !== undefined) {
		error.name = name
	}
	if (code !== undefined) {
		error.code = code
	}
	if (stack !== undefined) {
		error.stack = stack
	}
	return error
}

export const encodeSerializedResponse = (
	response: SerializedFsResponse
): Uint8Array => {
	const writer = new BinaryWriter()
	if (response.ok) {
		writer.writeUint8(ResponseTag.Ok)
		const value =
			response.value ?? ({ type: 'undefined' } as SerializedFsValue)
		writeFsValue(writer, value)
	} else {
		writer.writeUint8(ResponseTag.Error)
		writeFsError(writer, response.error)
	}
	return writer.toUint8Array()
}

export const decodeSerializedResponse = (
	bytes: Uint8Array
): SerializedFsResponse => {
	const reader = new BinaryReader(bytes)
	const tag = reader.readUint8()
	if (tag === ResponseTag.Ok) {
		const value = readFsValue(reader)
		return { ok: true, value }
	}
	if (tag === ResponseTag.Error) {
		const error = readFsError(reader)
		return { ok: false, error }
	}
	throw new Error(`Unknown filesystem response tag ${tag}`)
}

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
	if (typeof (stats as any).isFile !== 'function') {
		Object.defineProperty(stats, 'isFile', {
			value() {
				return this.type === 'file'
			},
			enumerable: false,
		})
	}
	if (typeof (stats as any).isDirectory !== 'function') {
		Object.defineProperty(stats, 'isDirectory', {
			value() {
				return this.type === 'dir'
			},
			enumerable: false,
		})
	}
	if (typeof (stats as any).isSymbolicLink !== 'function') {
		Object.defineProperty(stats, 'isSymbolicLink', {
			value() {
				return this.type === 'symlink'
			},
			enumerable: false,
		})
	}
	if (typeof (stats as any).isBlockDevice !== 'function') {
		Object.defineProperty(stats, 'isBlockDevice', {
			value() {
				return false
			},
			enumerable: false,
		})
	}
	if (typeof (stats as any).isCharacterDevice !== 'function') {
		Object.defineProperty(stats, 'isCharacterDevice', {
			value() {
				return false
			},
			enumerable: false,
		})
	}
	if (typeof (stats as any).isFIFO !== 'function') {
		Object.defineProperty(stats, 'isFIFO', {
			value() {
				return false
			},
			enumerable: false,
		})
	}
	if (typeof (stats as any).isSocket !== 'function') {
		Object.defineProperty(stats, 'isSocket', {
			value() {
				return false
			},
			enumerable: false,
		})
	}
	return stats
}

function hydrateDirent(data: { name: string; type: string }): Dirent {
	const dirent: Dirent = Object.create(Dirent.prototype)
	dirent.name = data.name
	dirent.type = data.type
	if (typeof (dirent as any).isDirectory !== 'function') {
		Object.defineProperty(dirent, 'isDirectory', {
			value() {
				return this.type === 'dir'
			},
			enumerable: false,
		})
	}
	if (typeof (dirent as any).isFile !== 'function') {
		Object.defineProperty(dirent, 'isFile', {
			value() {
				return this.type === 'file'
			},
			enumerable: false,
		})
	}
	if (typeof (dirent as any).isSymbolicLink !== 'function') {
		Object.defineProperty(dirent, 'isSymbolicLink', {
			value() {
				return this.type === 'symlink'
			},
			enumerable: false,
		})
	}
	if (typeof (dirent as any).isBlockDevice !== 'function') {
		Object.defineProperty(dirent, 'isBlockDevice', {
			value() {
				return false
			},
			enumerable: false,
		})
	}
	if (typeof (dirent as any).isCharacterDevice !== 'function') {
		Object.defineProperty(dirent, 'isCharacterDevice', {
			value() {
				return false
			},
			enumerable: false,
		})
	}
	if (typeof (dirent as any).isFIFO !== 'function') {
		Object.defineProperty(dirent, 'isFIFO', {
			value() {
				return false
			},
			enumerable: false,
		})
	}
	if (typeof (dirent as any).isSocket !== 'function') {
		Object.defineProperty(dirent, 'isSocket', {
			value() {
				return false
			},
			enumerable: false,
		})
	}
	return dirent
}
