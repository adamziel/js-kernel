declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []
			let recursive = false
			const targets: string[] = []

			for (const arg of argv) {
				if (arg === '-p') {
					recursive = true
				} else {
					targets.push(String(arg))
				}
			}

			if (targets.length === 0) {
				console.error('mkdir: missing operand')
				console.error('usage: mkdir [-p] <path>...')
				try {
					processController.exit(1)
				} catch {
					// ignore
				}
				return
			}

			const fs = processController.fsSync
			let hadError = false

			for (const target of targets) {
				try {
					fs.mkdirSync(target, { recursive, mode: 0o755 })
				} catch (error) {
					const message =
						error &&
						typeof error === 'object' &&
						'message' in error &&
						typeof (error as { message?: unknown }).message === 'string'
							? (error as { message: string }).message
							: String(error ?? 'Unknown error')
					console.error(`mkdir: ${target}: ${message}`)
					hadError = true
				}
			}

			try {
				processController.exit(hadError ? 1 : 0)
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
			console.error(`mkdir: ${message}`)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const mkdirProgramSource = createProgramSource()
