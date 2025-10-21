declare const processController: {
	argv(): string[]
	exit(code: number): void
	getEnv?(name: string): string
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
			let loaderUrl = urls.nodeLoaderUrl
			try {
				const override =
					typeof processController?.getEnv === 'function'
						? processController.getEnv('NODE_LOADER_URL')
						: ''
				if (override && override.length > 0) {
					loaderUrl = override
				}
			} catch {
				// Ignore env lookup failures.
			}
			const { loadNode } = await import(
				/* @vite-ignore */ loaderUrl
			)
			const runtime = await loadNode()
			await runtime.runMain()
			// We can't just exit for the process – this would kill it
			// even when it starts async work, e.g. npm install.
			// We also can't not exit for the process – this would keep it
			// running even when there's no more work to do.
			// @TODO: How can we ensure all the Node scripts exit at the
			//        end once there's no more pending timers or sockets?
			// exitSafely(0)
		} catch (error) {
			console.trace(error);
			writeStderr(`node: <internal>: ${errorToString(error)}`)
			// See above.
			// exitSafely(1)
		}
	}

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
		nodeLoaderUrl,
	})});`
}

export const nodeProgramSource = createProgramSource()
