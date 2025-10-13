declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		const getErrorMessage = (prefix: string, error: unknown) => {
			const message =
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof (error as { message?: unknown }).message === 'string'
					? (error as { message: string }).message
					: String(error ?? 'Unknown error')
			console.error(`${prefix}: ${message}`)
		}

		const basename = (path: string): string => {
			if (!path || path === '/') {
				return '/'
			}
			const segments = path.split('/').filter(Boolean)
			return segments.length ? segments[segments.length - 1] : path
		}

		const joinPath = (dir: string, name: string): string => {
			if (dir === '/') {
				return `/${name}`
			}
			const normalized =
				dir.length > 1 ? dir.replace(/\/+$/, '') : dir || '.'
			return `${normalized}/${name}`
		}

	const isDirectory = (stats: unknown): boolean => {
		return Boolean(
			stats &&
				typeof stats === 'object' &&
				'isDirectory' in stats &&
				typeof (stats as { isDirectory(): unknown }).isDirectory ===
					'function' &&
				Boolean((stats as { isDirectory(): boolean }).isDirectory())
		)
	}

		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []
			const operands: string[] = []

			for (const arg of argv) {
				if (arg === '-f') {
					continue
				}
				operands.push(String(arg))
			}

			if (operands.length < 2) {
				console.error('cp: missing file operand')
				console.error('usage: cp [-f] <source>... <destination>')
				try {
					processController.exit(1)
				} catch {
					// ignore
				}
				return
			}

		const destination = operands.pop() as string
		const sources = operands
		const fs = processController.fsSync

		let destinationIsDirectory = false
		try {
			destinationIsDirectory = isDirectory(
				fs.statSync(destination)
			)
		} catch {
			destinationIsDirectory = false
		}

		if (sources.length > 1 && !destinationIsDirectory) {
				console.error(
					'cp: target must be a directory when copying multiple files'
				)
				try {
					processController.exit(1)
				} catch {
					// ignore
				}
				return
			}

			let hadError = false

			for (const source of sources) {
				try {
					const sourceStats = fs.statSync(source)
					if (isDirectory(sourceStats)) {
						console.error(
							`cp: ${source}: directory copy is not supported (use -r)`
						)
						hadError = true
						continue
					}

					const data = fs.readFileSync(source)
					let targetPath = destination
					if (destinationIsDirectory) {
						targetPath = joinPath(destination, basename(source))
					}

					fs.writeFileSync(targetPath, data)
				} catch (error) {
					getErrorMessage(`cp: ${source}`, error)
					hadError = true
				}
			}

			try {
				processController.exit(hadError ? 1 : 0)
			} catch {
				// ignore
			}
		} catch (error) {
			getErrorMessage('cp', error)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const cpProgramSource = createProgramSource()
