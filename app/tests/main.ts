import { run } from './harness.ts'
import './kernel.test.ts'

declare global {
        interface Window {
                __kernelTestsComplete?: boolean
        }
}

const start = async () => {
        try {
                await run()
        } catch (error) {
                console.error('Kernel tests failed', error)
        } finally {
                window.__kernelTestsComplete = true
        }
}

if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
                start().catch((error) => console.error(error))
        })
} else {
        start().catch((error) => console.error(error))
}
