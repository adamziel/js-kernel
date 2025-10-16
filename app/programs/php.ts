const utilsModuleUrl = new URL(
	'../../runtime/busybox/lib/utils.ts',
	import.meta.url
).href
const phpLoaderUrl = new URL('./php-loader.ts', import.meta.url).href

const createProgramSource = (): string => {
	const program = async function main(urls: {
		utilsModuleUrl: string
		phpLoaderUrl: string
	}): Promise<void> {
		const { errorToString, exitSafely, getArgv, writeStdout, writeStderr } =
			await import(/* @vite-ignore */ urls.utilsModuleUrl)
		try {
			const { loadPhp } = await import(
				/* @vite-ignore */ urls.phpLoaderUrl
			)
			const php = await loadPhp()

			const scriptName = getArgv()[0]
			if (!scriptName) {
				writeStderr('php: script name is required')
				exitSafely(1)
				return
			}

			// TODO: Integrate PHP spawn handler with the kernel
			// php.setSpawnHandler((args) => {
			// 	console.log('php spawn handler', args)
			// 	return {
			// 		exitCode: 0,
			// 		stdout: 'php info',
			// 	}
			// })
			// const response = await php.cli(['/tmp/my-script.php'])

			// TODO: Integrate PHP directly with our filesystem
			const script = await processController.fs.readFile(scriptName)
			php.writeFile('/tmp/my-script.php', script)
			const response = await php.run({
				scriptPath: '/tmp/my-script.php',
			})

			const text = await response.text
			if (text.length > 0) {
				writeStdout(text, { appendNewline: false })
			}
			const error = await response.error
			if (error) {
				writeStderr(error)
			}

			exitSafely(response.exitCode ?? 0)
		} catch (error) {
			console.error('php error', error.stack)
			writeStderr(`php: <internal>: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
		phpLoaderUrl,
	})});`
}

export const phpProgramSource = createProgramSource()
