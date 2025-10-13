declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		try {
			const cwd =
				typeof processController.cwd === 'function'
					? processController.cwd()
					: '/'
			console.log(String(cwd ?? '/'))
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
			console.error(`pwd: ${message}`)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const pwdProgramSource = createProgramSource()
