declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		const formatError = (prefix: string, error: unknown) => {
			const message =
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof (error as { message?: unknown }).message === 'string'
					? (error as { message: string }).message
					: String(error ?? 'Unknown error')
			console.error(`${prefix}: ${message}`)
		}

		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []

			let recursive = false
			let force = false
			const targets: string[] = []

			for (const arg of argv) {
				if (arg === '-r' || arg === '-R') {
					recursive = true
					continue
				}
				if (arg === '-f') {
					force = true
					continue
				}
				targets.push(String(arg))
			}

			if (targets.length === 0) {
				if (!force) {
					console.error('rm: missing operand')
					console.error('usage: rm [-f] [-r] <path>...')
				}
				try {
					processController.exit(force ? 0 : 1)
				} catch {
					// ignore
				}
				return
			}

			const fs = processController.fsSync
			let hadError = false

			for (const target of targets) {
				try {
					fs.rmSync(target, { recursive, force })
				} catch (error) {
					if (force) {
						continue
					}
					formatError(`rm: ${target}`, error)
					hadError = true
				}
			}

			try {
				processController.exit(hadError ? 1 : 0)
			} catch {
				// ignore
			}
		} catch (error) {
			formatError('rm', error)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const rmProgramSource = createProgramSource()
