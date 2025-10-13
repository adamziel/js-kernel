declare const processController: any

const createProgramSource = (): string => {
	const program = async function main(): Promise<void> {
		const reportError = (message: string) => {
			console.error(`ln: ${message}`)
		}

		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []

			let symbolic = false
			const operands: string[] = []

			for (const arg of argv) {
				if (arg === '-s') {
					symbolic = true
					continue
				}
				operands.push(String(arg))
			}

			if (operands.length < 2) {
				reportError('missing file operand')
				try {
					processController.exit(1)
				} catch {
					// ignore
				}
				return
			}

			if (operands.length > 2) {
				reportError('only one source and one destination are supported')
				try {
					processController.exit(1)
				} catch {
					// ignore
				}
				return
			}

			const [target, linkPath] = operands
			const fs = processController.fsSync

			try {
				if (symbolic) {
					fs.symlinkSync(target, linkPath)
				} else {
					fs.linkSync(target, linkPath)
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
				reportError(`${linkPath}: ${message}`)
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
			reportError(message)
			try {
				processController.exit(1)
			} catch {
				// ignore
			}
		}
	}

	return `(${program.toString()})();`
}

export const lnProgramSource = createProgramSource()
