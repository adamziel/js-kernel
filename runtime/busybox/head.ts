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
		} = await import( /* @vite-ignore */urls.utilsModuleUrl)

		try {
			const argv = getArgv()
			let count = 10
			const files: string[] = []

			for (let index = 0; index < argv.length; index += 1) {
				const arg = argv[index]
				if (arg === '-n' && index + 1 < argv.length) {
					const next = Number(argv[index + 1])
					if (!Number.isNaN(next) && next >= 0) {
						count = next
						index += 1
						continue
					}
				}
				files.push(String(arg))
			}

			if (files.length === 0) {
				writeStderr('head: missing file operand')
				exitSafely(1)
				return
			}

			const fs = processController.fsSync
			const decoder = new TextDecoder()
			let hadError = false

			for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
				const file = files[fileIndex]
				try {
					const data = fs.readFileSync(file)
					const text =
						typeof data === 'string' ? data : decoder.decode(data)
					const lines = text.split('\n')
					const outputLines =
						count === 0 ? [] : lines.slice(0, count)

					if (files.length > 1) {
						writeStdout(`==> ${file} <==`)
					}
					for (const line of outputLines) {
						writeStdout(line)
					}
					if (files.length > 1 && fileIndex < files.length - 1) {
						writeStdout('')
					}
				} catch (error) {
					writeStderr(`head: ${file}: ${errorToString(error)}`)
					hadError = true
				}
			}

			exitSafely(hadError ? 1 : 0)
		} catch (error) {
			writeStderr(`head: <internal>: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const headProgramSource = createProgramSource()
