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
			const cwd =
				typeof processController.cwd === 'function'
					? processController.cwd()
					: '/'
			writeStdout(String(cwd ?? '/'))
			exitSafely(0)
		} catch (error) {
			writeStderr(`pwd: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const pwdProgramSource = createProgramSource()
