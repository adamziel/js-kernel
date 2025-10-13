export const createProcessWorker = () =>
	new Worker(
		new URL('./child/controller.ts', import.meta.url),
		{ type: 'module' }
	)
