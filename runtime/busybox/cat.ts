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
			writeStdout,
			writeStderr,
		} = await import(urls.utilsModuleUrl)

		try {
			const files = getArgv()

			if (files.length === 0) {
				writeStderr('cat: missing file operand')
				exitSafely(1)
				return
			}

			const fs = processController.fsSync
			const decoder = new TextDecoder()
			let hadError = false

			for (const file of files) {
				try {
					const data = fs.readFileSync(file)
					const text =
						typeof data === 'string' ? data : decoder.decode(data)
					if (text.length > 0) {
						writeStdout(text, { appendNewline: false })
					}
				} catch (error) {
					writeStderr(`cat: ${file}: ${errorToString(error)}`)
					hadError = true
				}
			}

			exitSafely(hadError ? 1 : 0)
		} catch (error) {
			writeStderr(`cat: <internal>: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const catProgramSource = createProgramSource()
