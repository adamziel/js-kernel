declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		const handleError = (path: string, error: unknown) => {
			const message =
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof (error as { message?: unknown }).message === 'string'
					? (error as { message: string }).message
					: String(error ?? 'Unknown error')
			console.error(`touch: ${path}: ${message}`)
		}

		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []
			const paths = argv.filter((arg) => typeof arg === 'string')

			if (paths.length === 0) {
				console.error('touch: missing file operand')
				try {
					processController.exit(1)
				} catch {
					// ignore
				}
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
					handleError(path, error)
					hadError = true
				}
			}

			try {
				processController.exit(hadError ? 1 : 0)
			} catch {
				// ignore
			}
		} catch (error) {
			handleError('<internal>', error)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const touchProgramSource = createProgramSource()
