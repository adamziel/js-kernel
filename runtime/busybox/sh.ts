declare const processController: any

const runnerModuleUrl = new URL('../shell/run.ts', import.meta.url).href
const parserModuleUrl = new URL('../shell/sh.ts', import.meta.url).href
const createProgramSource = (): string => {
	const program = async function main(
		runUrl: string,
		parseUrl: string
	): Promise<void> {
		// Vite is stubborn and wraps the dynamic imports below with a function that adds a query parameter
		// __vite__injectQuery(url, 'import') call. Let's provide a dummy implementation that's normally
		// missing in the program worker.
		function __vite__injectQuery(url: string): string {
			return url
		}

		const safeExit = (code: number) => {
			try {
				processController.exit(code)
			} catch {
				// ignore
			}
		}

		const formatError = (error: unknown): string => {
			if (
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof (error as { message?: unknown }).message === 'string'
			) {
				return (error as { message: string }).message
			}
			return String(error ?? 'Unknown error')
		}

		try {
			const rawArgv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			const argv = Array.isArray(rawArgv) ? rawArgv.slice(1) : []

			if (argv.length !== 1) {
				console.error('sh: expected exactly one script path')
				safeExit(1)
				return
			}

			const scriptPath = argv[0]
			const fs = processController.fsSync
			const decoder = new TextDecoder()

			let source: string
			try {
				const data = fs.readFileSync(scriptPath, 'utf8')
				source =
					typeof data === 'string'
						? data
						: decoder.decode(data as Uint8Array)
			} catch (error) {
				console.error(`sh: ${scriptPath}: ${formatError(error)}`)
				safeExit(1)
				return
			}

			let runShellScript: (
				pc: typeof processController,
				root: unknown
			) => Promise<number>
			let parseShellCode: (source: string) => unknown
			try {
				const [{ runShellScript: run }, { parseShellCode: parse }] =
					await Promise.all([import(runUrl), import(parseUrl)])
				runShellScript = run!
				parseShellCode = parse!
			} catch (error) {
				console.error(
					`sh: failed to load shell runtime: ${formatError(error)}`
				)
				safeExit(1)
				return
			}

			let ast: unknown
			try {
				ast = parseShellCode(source)
			} catch (error) {
				console.error(`sh: ${scriptPath}: ${formatError(error)}`)
				safeExit(2)
				return
			}

			try {
				const exitCode = await runShellScript(processController, ast)
				safeExit(exitCode)
			} catch (error) {
				console.error(`sh: ${formatError(error)}`)
				safeExit(1)
			}
		} catch (error) {
			console.error(`sh: ${formatError(error)}`)
			safeExit(1)
		}
	}

	console.log('runnerModuleUrl', runnerModuleUrl)
	console.log('parserModuleUrl', parserModuleUrl)
	return `(${program.toString()})(${JSON.stringify(
		runnerModuleUrl
	)}, ${JSON.stringify(parserModuleUrl)});`
}

export const shProgramSource = createProgramSource()
