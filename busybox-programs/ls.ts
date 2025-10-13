declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []
			const targets = argv.length ? argv : ['.']
			const fs = processController.fsSync
			let hadError = false

			const formatError = (target: string, error: unknown) => {
				const message =
					error &&
					typeof error === 'object' &&
					'message' in error &&
					typeof (error as { message?: unknown }).message === 'string'
						? (error as { message: string }).message
						: String(error ?? 'Unknown error')
				console.error(`ls: ${target}: ${message}`)
				hadError = true
			}

			for (let index = 0; index < targets.length; index += 1) {
				const target = targets[index]
				try {
					const stats = fs.statSync(target)
					if (stats && typeof stats.isDirectory === 'function' && stats.isDirectory()) {
						const entries = fs.readdirSync(target) as unknown[]
						if (targets.length > 1) {
							console.log(`${target}:`)
						}
						const names = entries
							.map((entry) => String(entry))
							.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
						for (const name of names) {
							console.log(name)
						}
						if (targets.length > 1 && index < targets.length - 1) {
							console.log('')
						}
					} else {
						console.log(target)
					}
				} catch (error) {
					formatError(target, error)
				}
			}

			try {
				processController.exit(hadError ? 1 : 0)
			} catch {
				// ignore exit errors
			}
		} catch (error) {
			const message =
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof (error as { message?: unknown }).message === 'string'
					? (error as { message: string }).message
					: String(error ?? 'Unknown error')
			console.error(`ls: ${message}`)
			try {
				processController.exit(1)
			} catch {
				// ignore exit errors
			}
		}
	}

	return `(${program.toString()})();`
}

export const lsProgramSource = createProgramSource()
