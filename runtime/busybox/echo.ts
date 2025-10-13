declare const processController: any

const utilsModuleUrl = new URL('./lib/utils.ts', import.meta.url).href

const createProgramSource = (): string => {
	const program = async function main(urls: {
		utilsModuleUrl: string
	}): Promise<void> {
		const {
			errorToString,
			exitSafely,
			getArgv,
			writeStdout,
			writeStderr,
		} = await import(urls.utilsModuleUrl)

		try {
			const argv = getArgv()
			const joined = argv.join(' ')
			writeStdout(joined)
			exitSafely(0)
		} catch (error) {
			writeStderr(`echo: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const echoProgramSource = createProgramSource()
