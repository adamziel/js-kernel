declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		const stdout = processController.stdout
		const writeLine = (line: string) => {
			const chunk = `${line}\n`
			if (stdout && typeof stdout.write === 'function') {
				stdout.write(chunk)
			} else {
				console.log(line)
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
			console.error(`head: ${path}: ${message}`)
		}

		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []

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
				console.error('head: missing file operand')
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
						writeLine(`==> ${file} <==`)
					}
					for (const line of outputLines) {
						writeLine(line)
					}
					if (files.length > 1 && fileIndex < files.length - 1) {
						writeLine('')
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

export const headProgramSource = createProgramSource()
