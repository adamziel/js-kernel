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
		} = await import( /* @vite-ignore */urls.utilsModuleUrl)

		try {
			const argv = getArgv()
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
				writeStderr('ln: missing file operand')
				exitSafely(1)
				return
			}

			if (operands.length > 2) {
				writeStderr('ln: only one source and one destination are supported')
				exitSafely(1)
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
				exitSafely(0)
			} catch (error) {
				writeStderr(`ln: ${linkPath}: ${errorToString(error)}`)
				exitSafely(1)
			}
		} catch (error) {
			writeStderr(`ln: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const lnProgramSource = createProgramSource()
