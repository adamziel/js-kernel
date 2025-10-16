import type {
        KernelStdioChunk,
        MessagePortReadableStream,
        MessagePortWritableStream,
} from '../../ipc/message-port.ts'
import type { KernelFsClient } from './fs-client.ts'
import type { SpawnSyncOutcome } from '../spawn-sync/client.ts'
import type { StdioMode } from '../spawn-options.ts'

export interface ProcessControllerReadableStreamLike {
        on(event: 'data', listener: (chunk: KernelStdioChunk) => void): unknown
        on(event: 'end' | 'close', listener: () => void): unknown
        once?(event: 'data', listener: (chunk: KernelStdioChunk) => void): unknown
        once?(event: 'end' | 'close', listener: () => void): unknown
        off?(event: 'data' | 'end' | 'close', listener: (...args: unknown[]) => void): void
        read?(): KernelStdioChunk | null
        close(): void
        destroy(): void
}

export interface ProcessControllerWritableStreamLike {
        on?(event: 'close', listener: () => void): unknown
        once?(event: 'close', listener: () => void): unknown
        off?(event: 'close', listener: () => void): void
        write(chunk: KernelStdioChunk): boolean
        end(chunk?: KernelStdioChunk): boolean
        close(): boolean
        destroy(): void
}

export type ProcessControllerReadableStream =
        | MessagePortReadableStream
        | ProcessControllerReadableStreamLike

export type ProcessControllerWritableStream =
        | MessagePortWritableStream
        | ProcessControllerWritableStreamLike

export interface ProcessControllerSpawnOptions {
        argv: string[]
        env?: Record<string, string>
        cwd?: string
        name?: string
        debug?: boolean
        stdio?: {
                stdin?: StdioMode
                stdout?: StdioMode
                stderr?: StdioMode
        }
        timeout?: number
        ipcPort?: MessagePort
        workerThreadId?: number
        workerThreadName?: string
}

export interface ProcessControllerChildProcess {
        pid: number
        stdin?: MessagePortWritableStream
        stdout?: MessagePortReadableStream
        stderr?: MessagePortReadableStream
        messagePort?: MessagePort | null
        threadId?: number
        threadName?: string
        onExit(listener: (code: number) => void): void
        offExit(listener: (code: number) => void): void
        kill(): void
        readonly exitCode: number | null
}

export interface ProcessController {
        argv(): string[]
        cwd(): string
        chdir(path: string): void
        getEnv(name: string): string
        setEnv(name: string, value: string): void
        getAllEnv(): Record<string, string>
        pid(): number
        executablePath(): string
        spawn(options: ProcessControllerSpawnOptions): Promise<ProcessControllerChildProcess>
        spawnSync(options: ProcessControllerSpawnOptions): SpawnSyncOutcome
        stdin: ProcessControllerReadableStream
        stdout: ProcessControllerWritableStream
        stderr: ProcessControllerWritableStream
        messagePort: MessagePort | null
        threadId(): number | null
        threadName(): string | null
        fs: KernelFsClient['async']
        fsSync: KernelFsClient['sync']
        exit(code: number): void
}

export type { StdioMode }
