declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		try {
			const env =
				typeof processController.getAllEnv === 'function'
					? processController.getAllEnv()
					: {}
			const entries = Object.entries(env ?? {}).sort(([a], [b]) =>
				a < b ? -1 : a > b ? 1 : 0
			)
			for (const [key, value] of entries) {
				console.log(`${key}=${String(value)}`)
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
			console.error(`env: ${message}`)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const envProgramSource = createProgramSource()
