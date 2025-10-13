export const createProcessWorker = () =>
	new Worker(
		new URL('./child-process-library.ts', import.meta.url),
		{ type: 'module' }
	)
