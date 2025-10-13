declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		const stdout = processController.stdout
		const writeChunk = (chunk: string) => {
			if (stdout && typeof stdout.write === 'function') {
				stdout.write(chunk)
			} else {
				console.log(chunk)
			}
		}

		const reportError = (path: string, error: unknown) => {
			const message =
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof (error as { message?: unknown }).message === 'string'
					? (error as { message: string }).message
					: String(error ?? 'Unknown error')
			console.error(`cat: ${path}: ${message}`)
		}

		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []
			const files = argv.length ? argv : []

			if (files.length === 0) {
				console.error('cat: missing file operand')
				try {
					processController.exit(1)
				} catch {
					// ignore
				}
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
						writeChunk(text)
					}
				} catch (error) {
					reportError(file, error)
					hadError = true
				}
			}

			try {
				processController.exit(hadError ? 1 : 0)
			} catch {
				// ignore
			}
		} catch (error) {
			reportError('<internal>', error)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const catProgramSource = createProgramSource()
