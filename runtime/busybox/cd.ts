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
			writeStderr,
		} = await import(urls.utilsModuleUrl)

		try {
			const argv = getArgv()
			const target = argv[0]

			if (!target) {
				writeStderr('cd: missing operand')
				exitSafely(1)
				return
			}

			try {
				if (typeof processController.chdir === 'function') {
					processController.chdir(target)
				}
				exitSafely(0)
			} catch (error) {
				writeStderr(`cd: ${errorToString(error)}`)
				exitSafely(1)
			}
		} catch (error) {
			writeStderr(`cd: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const cdProgramSource = createProgramSource()
