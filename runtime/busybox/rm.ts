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
			let force = false
			const targets: string[] = []

			for (const arg of argv) {
				if (arg === '-r' || arg === '-R') {
					recursive = true
					continue
				}
				if (arg === '-f') {
					force = true
					continue
				}
				targets.push(String(arg))
			}

			if (targets.length === 0) {
				if (!force) {
					writeStderr('rm: missing operand')
					writeStderr('usage: rm [-f] [-r] <path>...')
				}
				exitSafely(force ? 0 : 1)
				return
			}

			const fs = processController.fsSync
			let hadError = false

			for (const target of targets) {
				try {
					fs.rmSync(target, { recursive, force })
				} catch (error) {
					if (force) {
						continue
					}
					writeStderr(`rm: ${target}: ${errorToString(error)}`)
					hadError = true
				}
			}

			exitSafely(hadError ? 1 : 0)
		} catch (error) {
			writeStderr(`rm: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
	})});`
}

export const rmProgramSource = createProgramSource()
