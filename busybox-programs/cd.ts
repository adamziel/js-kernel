declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []
			const target = argv[0]

			if (!target) {
				console.error('cd: missing operand')
				try {
					processController.exit(1)
				} catch {
					// ignore
				}
				return
			}

			try {
				if (typeof processController.chdir === 'function') {
					processController.chdir(target)
				}
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
				console.error(`cd: ${message}`)
				try {
					processController.exit(1)
				} catch {
					// ignore
				}
			}
		} catch (error) {
			const message =
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof (error as { message?: unknown }).message === 'string'
					? (error as { message: string }).message
					: String(error ?? 'Unknown error')
			console.error(`cd: ${message}`)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const cdProgramSource = createProgramSource()
