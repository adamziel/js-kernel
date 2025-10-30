import { parseShellCode } from './shell/sh.ts'

export {
	Kernel,
	KernelClass,
	ExitCode,
	type KernelSubprocess,
	type KernelSubprocessExtras,
	type SpawnOptions,
	type SpawnSyncOutcome,
} from './core/kernel.ts'
export type {
	KernelStdioChunk,
	SpawnStdioOptions,
	StdioMode,
} from './core/kernel.ts'
