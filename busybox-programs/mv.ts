declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		const describeError = (prefix: string, error: unknown) => {
			const message =
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof (error as { message?: unknown }).message === 'string'
					? (error as { message: string }).message
					: String(error ?? 'Unknown error')
			console.error(`${prefix}: ${message}`)
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
			const trimmed =
				dir === '' ? '.' : dir.replace(/\/+$/, '') || '/'
			return `${trimmed}/${name}`
		}

		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []

			let force = false
			const operands: string[] = []

			for (const arg of argv) {
				if (arg === '-f') {
					force = true
					continue
				}
				operands.push(String(arg))
			}

			if (operands.length < 2) {
				console.error('mv: missing file operand')
				console.error('usage: mv [-f] <source>... <destination>')
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
				destinationIsDirectory = isDirectory(fs.statSync(destination))
			} catch {
				destinationIsDirectory = false
			}

			if (sources.length > 1 && !destinationIsDirectory) {
				console.error(
					'mv: target must be a directory when moving multiple files'
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
					const targetPath = destinationIsDirectory
						? joinPath(destination, basename(source))
						: destination

					if (force && fs.existsSync(targetPath)) {
						try {
							const targetStats = fs.statSync(targetPath)
							if (isDirectory(targetStats)) {
								console.error(
									`mv: cannot overwrite directory '${targetPath}'`
								)
								hadError = true
								continue
							}
							fs.unlinkSync(targetPath)
						} catch (removeError) {
							describeError(`mv: ${targetPath}`, removeError)
							hadError = true
							continue
						}
					}

					fs.renameSync(source, targetPath)
				} catch (error) {
					describeError(`mv: ${source}`, error)
					hadError = true
				}
			}

			try {
				processController.exit(hadError ? 1 : 0)
			} catch {
				// ignore
			}
		} catch (error) {
			describeError('mv', error)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const mvProgramSource = createProgramSource()
