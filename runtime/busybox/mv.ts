declare const processController: any

const utilsModuleUrl = new URL('./lib/utils.ts', import.meta.url).href

const createProgramSource = (): string => {
	const program = async function main(urls: {
		utilsModuleUrl: string
	}): Promise<void> {
		const {
			errorToString,
			exitSafely,
			getArgv,
			writeStderr,
		} = await import(urls.utilsModuleUrl)

		const isDirectory = (stats: unknown): boolean =>
			Boolean(
				stats &&
					typeof stats === 'object' &&
					'isDirectory' in stats &&
					typeof (stats as { isDirectory(): unknown }).isDirectory ===
						'function' &&
					Boolean(
						(stats as { isDirectory(): boolean }).isDirectory()
					)
			)

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
			const argv = getArgv()
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
				writeStderr('mv: missing file operand')
				writeStderr('usage: mv [-f] <source>... <destination>')
				exitSafely(1)
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
				writeStderr(
					'mv: target must be a directory when moving multiple files'
				)
				exitSafely(1)
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
								writeStderr(
									`mv: cannot overwrite directory '${targetPath}'`
								)
								hadError = true
								continue
							}
							fs.unlinkSync(targetPath)
						} catch (removeError) {
							writeStderr(
								`mv: ${targetPath}: ${errorToString(removeError)}`
							)
							hadError = true
							continue
						}
					}

					fs.renameSync(source, targetPath)
				} catch (error) {
					writeStderr(`mv: ${source}: ${errorToString(error)}`)
					hadError = true
				}
			}

			exitSafely(hadError ? 1 : 0)
		} catch (error) {
			writeStderr(`mv: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const mvProgramSource = createProgramSource()
