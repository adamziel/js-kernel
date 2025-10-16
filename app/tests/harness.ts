const tests: Array<{ name: string; fn: () => unknown | Promise<unknown> }> = []
const stack: string[] = []

export const describe = (name: string, fn: () => void) => {
        stack.push(name)
        try {
                fn()
        } finally {
                stack.pop()
        }
}

export const test = (name: string, fn: () => unknown | Promise<unknown>) => {
        const parts = [...stack, name].filter(Boolean)
        tests.push({ name: parts.join(' › '), fn })
}

export interface TestResult {
        name: string
        status: 'passed' | 'failed'
        duration: number
        error?: unknown
}

const formatError = (error: unknown): string => {
        if (error instanceof Error) {
                return error.stack ?? error.message
        }
        try {
                return JSON.stringify(error)
        } catch {
                return String(error)
        }
}

const renderResults = (results: TestResult[]) => {
        const container = document.getElementById('test-results')
        if (!container) {
                return
        }
        container.innerHTML = ''

        const summary = document.createElement('div')
        summary.className = 'summary'
        const passed = results.filter((result) => result.status === 'passed').length
        const failed = results.length - passed
        summary.textContent = `Passed: ${passed} • Failed: ${failed}`
        container.appendChild(summary)

        const list = document.createElement('ul')
        list.className = 'results'
        for (const result of results) {
                const item = document.createElement('li')
                item.className = result.status
                const title = document.createElement('span')
                title.className = 'name'
                title.textContent = result.name
                item.appendChild(title)

                const duration = document.createElement('span')
                duration.className = 'duration'
                duration.textContent = `${result.duration.toFixed(2)}ms`
                item.appendChild(duration)

                if (result.status === 'failed' && result.error) {
                        const details = document.createElement('pre')
                        details.className = 'error'
                        details.textContent = formatError(result.error)
                        item.appendChild(details)
                }

                list.appendChild(item)
        }

        container.appendChild(list)
}

export const run = async () => {
        const results: TestResult[] = []
        for (const { name, fn } of tests) {
                const started = performance.now()
                try {
                        await fn()
                        const finished = performance.now()
                        const result: TestResult = {
                                name,
                                status: 'passed',
                                duration: finished - started,
                        }
                        results.push(result)
                        console.log(`✅ ${name}`)
                } catch (error) {
                        const finished = performance.now()
                        const result: TestResult = {
                                name,
                                status: 'failed',
                                error,
                                duration: finished - started,
                        }
                        results.push(result)
                        console.error(`❌ ${name}`, error)
                }
        }

        renderResults(results)

        const failed = results.filter((result) => result.status === 'failed').length
        if (failed > 0) {
                        throw new Error(`${failed} test${failed === 1 ? '' : 's'} failed`)
        }

        return results
}
