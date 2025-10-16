const binding = globalThis.internalBinding('ps')

const ensureOptions = (options) => {
        if (options !== undefined && (options === null || typeof options !== 'object')) {
                throw new TypeError('options must be an object if provided')
        }
        return options ?? {}
}

const listProcesses = (options) => {
        const normalized = ensureOptions(options)
        return binding.listProcesses(normalized)
}

const getProcess = (pid, options) => {
        if (typeof pid !== 'number' || !Number.isFinite(pid)) {
                throw new TypeError('pid must be a finite number')
        }
        const normalized = ensureOptions(options)
        return binding.getProcess(pid, normalized)
}

module.exports = {
        listProcesses,
        getProcess,
        constants: binding.constants ?? {},
}

module.exports.default = module.exports
