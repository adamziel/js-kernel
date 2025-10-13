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

		try {
			const argv = getArgv()
			const operands: string[] = []

			for (const arg of argv) {
				if (arg === '-f') continue
				operands.push(String(arg))
			}

			if (operands.length < 2) {
				writeStderr('cp: missing file operand')
				writeStderr('usage: cp [-f] <source>... <destination>')
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
					'cp: target must be a directory when copying multiple files'
				)
				exitSafely(1)
				return
			}

			let hadError = false

			for (const source of sources) {
				try {
					const sourceStats = fs.statSync(source)
					if (isDirectory(sourceStats)) {
						writeStderr(
							`cp: ${source}: directory copy is not supported (use -r)`
						)
						hadError = true
						continue
					}

					const data = fs.readFileSync(source)
					const targetPath = destinationIsDirectory
						? joinPath(destination, basename(source))
						: destination

					fs.writeFileSync(targetPath, data)
				} catch (error) {
					writeStderr(`cp: ${source}: ${errorToString(error)}`)
					hadError = true
				}
			}

			exitSafely(hadError ? 1 : 0)
		} catch (error) {
			writeStderr(`cp: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const cpProgramSource = createProgramSource()
