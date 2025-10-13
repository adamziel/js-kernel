declare const processController: any

interface WritableStreamLike {
	write(chunk: string): void
}

const getStream = (name: 'stdout' | 'stderr'): WritableStreamLike | null => {
	const stream = processController?.[name]
	if (stream && typeof stream.write === 'function') {
		return stream as WritableStreamLike
	}
	return null
}

const writeToStream = (
	stream: WritableStreamLike | null,
	fallback: (chunk: string) => void,
	message: string,
	appendNewline: boolean
) => {
	const chunk =
		appendNewline && !message.endsWith('\n')
			? `${message}\n`
			: message
	if (stream) {
		stream.write(chunk)
	} else {
		fallback(chunk)
	}
}

export function getArgv(): string[] {
	const raw = processController.argv()
	return Array.isArray(raw) ? raw.slice(1) : []
}

export function writeStdout(
	message: string,
	options: { appendNewline?: boolean } = {}
) {
	const { appendNewline = true } = options
	writeToStream(getStream('stdout'), console.log, message, appendNewline)
}

export function writeStderr(
	message: string,
	options: { appendNewline?: boolean } = {}
) {
	const { appendNewline = true } = options
	writeToStream(getStream('stderr'), console.error, message, appendNewline)
}

export function exitSafely(code: number) {
	try {
		processController.exit(code)
	} catch {
		// ignore
	}
}

export function errorToString(error: unknown): string {
	return error &&
		typeof error === 'object' &&
		'message' in error &&
		typeof (error as { message?: unknown }).message === 'string'
		? (error as { message: string }).message
		: String(error ?? 'Unknown error')
}
