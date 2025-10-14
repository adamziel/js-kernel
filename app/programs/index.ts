import { Kernel } from '../../runtime/index.ts'
import { joinPaths } from '../../runtime/util/paths.ts'
import { phpProgramSource } from './php.ts'

export const programs: Record<string, string> = {
	php: phpProgramSource,
}

export type ProgramName = keyof typeof programs

// Initiate programs
export function installCustomPrograms(kernel: Kernel, path = '/bin') {
	kernel.mkdirSync(path, { mode: 0o755, recursive: true })
	for (const [name, source] of Object.entries(programs)) {
		kernel.writeFileSync(joinPaths(path, name), `${source}\n`, {
			mode: 0o755,
		})
	}
}
