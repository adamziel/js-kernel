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
			const targets = getArgv()
			const fs = processController.fsSync
			const decoder = new TextDecoder()
			let hadError = false

			const readFromStdin = async () => {
				const stdin = processController.stdin
				if (!stdin || typeof stdin.on !== 'function') {
					return
				}
				await new Promise<void>((resolve) => {
					const handleData = (chunk: unknown) => {
						const text =
							typeof chunk === 'string'
								? chunk
								: decoder.decode(chunk as Uint8Array)
						if (text.length > 0) {
							writeStdout(text, { appendNewline: false })
						}
					}
					const cleanup = () => {
						stdin.off?.('data', handleData as any)
						resolve()
					}
					stdin.on('data', handleData as any)
					stdin.once?.('end', () => cleanup()) ??
						stdin.on?.('end', () => cleanup())
					stdin.once?.('close', () => cleanup()) ??
						stdin.on?.('close', () => cleanup())
				})
			}

			const files = targets.length ? targets : ['-']

			for (const file of files) {
				if (file === '-') {
					await readFromStdin()
					continue
				}
				try {
					const data = fs.readFileSync(file)
					const text =
						typeof data === 'string'
							? data
							: decoder.decode(data)
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
