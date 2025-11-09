import { Kernel } from '../../runtime/index.ts'
import { joinPaths } from '../../runtime/util/paths.ts'
import { extractTarProgramSource } from './extract-tar.ts'
import { phpProgramSource } from './php.ts'
import { nodeProgramSource } from './node.ts'

export const programs: Record<string, string> = {
	php: phpProgramSource,
	node: nodeProgramSource,
	'extract-tar': extractTarProgramSource,
}

export type ProgramName = keyof typeof programs

// Initiate programs
const EXPORT_DEFAULT_PATTERN = /\bexport\s+default\b/

const wrapProgramModule = (source: string): string => {
	if (EXPORT_DEFAULT_PATTERN.test(source)) {
		return source
	}
	const trimmed = source.trimEnd()
	return `export default async function __programModuleEntry(processController) {\n\treturn ${trimmed}\n}`
}

export function installCustomPrograms(kernel: Kernel, path = '/bin') {
	kernel.mkdirSync(path, { mode: 0o755, recursive: true })
	for (const [name, source] of Object.entries(programs)) {
		const wrapped = wrapProgramModule(source)
		kernel.writeFileSync(joinPaths(path, name), `${wrapped}\n`, {
			mode: 0o755,
		})
	}
}
