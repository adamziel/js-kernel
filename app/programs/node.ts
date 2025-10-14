declare const processController: {
	argv(): string[]
	exit(code: number): void
}

const utilsModuleUrl = new URL(
	'../../runtime/busybox/lib/utils.ts',
	import.meta.url
).href
const nodeLoaderUrl = new URL(
	'./node-loader.ts',
	import.meta.url
).href

const createProgramSource = (): string => {
	const program = async function main(urls: {
		utilsModuleUrl: string
		nodeLoaderUrl: string
	}) {
		const { errorToString, exitSafely, writeStderr } = await import(
			/* @vite-ignore */ urls.utilsModuleUrl
		)

		try {
			const { loadNode } = await import(
				/* @vite-ignore */ urls.nodeLoaderUrl
			)
			const runtime = await loadNode()
			const argv =
				typeof processController.argv === 'function'
					? processController.argv()
					: []
			await runtime.runMain()
			exitSafely(0)
		} catch (error) {
			console.trace(error);
			writeStderr(`node: <internal>: ${errorToString(error)}`)
			exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
		nodeLoaderUrl,
	})});`
}

export const nodeProgramSource = createProgramSource()
