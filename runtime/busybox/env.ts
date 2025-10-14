declare const processController: any

const utilsModuleUrl = new URL('./lib/utils.ts', import.meta.url).href

const createProgramSource = (): string => {
	const program = async function main(urls: {
		utilsModuleUrl: string
	}): Promise<void> {
		const {
			errorToString,
			exitSafely,
			writeStdout,
			writeStderr,
		} = await import( /* @vite-ignore */urls.utilsModuleUrl)

		try {
			const env =
				typeof processController.getAllEnv === 'function'
					? processController.getAllEnv()
					: {}
			const entries = Object.entries(env ?? {}).sort(([a], [b]) =>
				a < b ? -1 : a > b ? 1 : 0
			)

			for (const [key, value] of entries) {
				writeStdout(`${key}=${String(value)}`)
			}

			exitSafely(0)
		} catch (error) {
			writeStderr(`env: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const envProgramSource = createProgramSource()
