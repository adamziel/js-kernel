import { InMemoryFileSystem } from './mixins/in-memory-fs'
import { joinPaths } from './paths-utils'

interface SpawnOptions {
	argv: string[]
	env: Record<string, string>
	cwd: string
	columns: number
	rows: number
	name: string
}

export const enum ExitCode {
	OK = 0,
	ERROR = 1,
	NOT_FOUND = 127,
}

class Kernel {

	private env: Record<string, string> = {
		PATH: '/bin',
	}

	constructor() {
		// @TODO: Configurable filesystem
		const fs = new InMemoryFileSystem()
		Object.assign(this, fs)
	}

	/**
	 * TypeScript hack to get typed access to the filesystem
	 * from inside of the Kernel class.
	 */
	private get fs(): InMemoryFileSystem {
		return this as any
	}

	setEnv(key: string, value: string) {
		this.env[key] = value
	}

	getEnv(key: string) {
		return this.env[key] || ''
	}

	resolveExecutable(name: string) {
		const paths = this.getEnv('PATH').split(':')
		for (const path of paths) {
			const executable = joinPaths(path, name)
			if (this.fs.existsSync(executable)) {
				return executable
			}
		}
		return null
	}

	spawn(options: SpawnOptions) {
		const executablePath = this.resolveExecutable(options.argv[0])
		if (!executablePath) {
			return ExitCode.NOT_FOUND;
		}

		const programCode = this.fs.readFileSync(executablePath, 'utf8');
		
	}
}

export const KernelClass = Kernel as typeof Kernel & InMemoryFileSystem
