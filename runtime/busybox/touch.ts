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
		} = await import( /* @vite-ignore */urls.utilsModuleUrl)

		try {
			const paths = getArgv()

			if (paths.length === 0) {
				writeStderr('touch: missing file operand')
				exitSafely(1)
				return
			}

			const fs = processController.fsSync
			const now = new Date()
			let hadError = false

			for (const path of paths) {
				try {
					if (fs.existsSync(path)) {
						fs.utimesSync(path, now, now)
					} else {
						fs.writeFileSync(path, '')
					}
				} catch (error) {
					writeStderr(`touch: ${path}: ${errorToString(error)}`)
					hadError = true
				}
			}

			exitSafely(hadError ? 1 : 0)
		} catch (error) {
			writeStderr(`touch: <internal>: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const touchProgramSource = createProgramSource()
