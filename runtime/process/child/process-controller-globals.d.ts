import type { ProcessController } from './process-controller-types.ts'

declare global {
        interface WorkerGlobalScope {
                readonly processController: ProcessController
                originalConsole: Console
        }

        const processController: ProcessController
}

export {}
