import { type KernelStdioChunk, MessagePortReadableStream } from '../../runtime/ipc/message-port.ts'

const textDecoder = new TextDecoder()

export const collectStream = (stream?: MessagePortReadableStream | null): Promise<string> => {
        if (!stream) {
                return Promise.resolve('')
        }
        return new Promise((resolve) => {
                const chunks: string[] = []
                const handleChunk = (chunk: KernelStdioChunk) => {
                        if (typeof chunk === 'string') {
                                chunks.push(chunk)
                        } else {
                                chunks.push(textDecoder.decode(chunk))
                        }
                }
                const finalize = () => {
                        stream.off('data', handleChunk)
                        stream.off('end', finalize)
                        stream.off('close', finalize)
                        resolve(chunks.join(''))
                }
                stream.on('data', handleChunk)
                stream.once('end', finalize)
                stream.once('close', finalize)
        })
}

export const waitForExit = (
        subprocess: { onExit: (listener: (code: number) => void) => void },
        timeoutMs = 5000
): Promise<number> => {
        return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                        reject(new Error('Timed out waiting for process exit'))
                }, timeoutMs)
                subprocess.onExit((code: number) => {
                        clearTimeout(timeout)
                        resolve(code)
                })
        })
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const waitForFirstChunk = (
        stream?: MessagePortReadableStream | null,
        timeoutMs = 2000
) => {
        if (!stream) {
                return Promise.resolve(undefined)
        }
        return new Promise<void>((resolve, reject) => {
                const handle = () => {
                        clearTimeout(timer)
                        stream.off('data', handle)
                        resolve()
                }
                const timer = setTimeout(() => {
                        stream.off('data', handle)
                        reject(new Error('Timed out waiting for stream data'))
                }, timeoutMs)
                stream.on('data', handle)
        })
}
