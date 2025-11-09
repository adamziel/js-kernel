export const builtinIds = ['internal/errors']
export const compileFunction = (id) => {
	if (id === 'internal/errors') {
		return () => {
			return {
				compileForInternalLoader: () => {
					return {}
				},
				prepareStackTraceCallback: () => {},
				fatalExceptionStackEnhancers: {
					beforeInspector: () => {},
					afterInspector: () => {},
				},
			}
		}
	} else {
		throw new Error(`Unknown builtin id: ${id}`)
	}
}
export const setInternalLoaders = () => {}
