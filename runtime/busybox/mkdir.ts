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
			let recursive = false
			const targets: string[] = []

			for (const arg of argv) {
				if (arg === '-p') {
					recursive = true
				} else {
					targets.push(String(arg))
				}
			}

			if (targets.length === 0) {
				writeStderr('mkdir: missing operand')
				writeStderr('usage: mkdir [-p] <path>...')
				exitSafely(1)
				return
			}

			const fs = processController.fsSync
			let hadError = false

			for (const target of targets) {
				try {
					fs.mkdirSync(target, { recursive, mode: 0o755 })
				} catch (error) {
					writeStderr(`mkdir: ${target}: ${errorToString(error)}`)
					hadError = true
				}
			}

			exitSafely(hadError ? 1 : 0)
		} catch (error) {
			writeStderr(`mkdir: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const mkdirProgramSource = createProgramSource()
