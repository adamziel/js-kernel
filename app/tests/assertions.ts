export const assert = (condition: unknown, message: string) => {
        if (!condition) {
                throw new Error(message)
        }
}

const compare = (a: unknown, b: unknown) => {
        if (Object.is(a, b)) {
                return true
        }
        if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) {
                return false
        }
        const keysA = Object.keys(a as Record<string, unknown>)
        const keysB = Object.keys(b as Record<string, unknown>)
        if (keysA.length !== keysB.length) {
                return false
        }
        for (const key of keysA) {
                if (!compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
                        return false
                }
        }
        return true
}

export const assertEqual = <T>(actual: T, expected: T, message?: string) => {
        if (!compare(actual, expected)) {
                throw new Error(message ?? `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
        }
}

export const assertThrows = async (fn: () => unknown | Promise<unknown>, message?: string) => {
        let threw = false
        try {
                await fn()
        } catch {
                threw = true
        }
        if (!threw) {
                throw new Error(message ?? 'Expected function to throw')
        }
}

export const assertArrayIncludes = <T>(array: T[], value: T, message?: string) => {
        if (!array.includes(value)) {
                throw new Error(message ?? `Expected array to include ${value}`)
        }
}
