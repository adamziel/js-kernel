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

		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []
			const joined = argv.join(' ')

			writeChunk(joined.length > 0 ? `${joined}\n` : '\n')
			try {
				processController.exit(0)
			} catch {
				// ignore
			}
		} catch (error) {
			const message =
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof (error as { message?: unknown }).message === 'string'
					? (error as { message: string }).message
					: String(error ?? 'Unknown error')
			console.error(`echo: ${message}`)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const echoProgramSource = createProgramSource()
