import { describe, test } from './harness.ts'
import { assert, assertArrayIncludes, assertEqual } from './assertions.ts'
import { Kernel, ExitCode } from '../../runtime/core/kernel.ts'
import { installBusybox } from '../../runtime/busybox/index.ts'
import { collectStream, wait, waitForExit, waitForFirstChunk } from './utils.ts'

const createKernel = () => {
        const kernel = new Kernel()
        kernel.mkdirSync('/bin', { mode: 0o755 })
        return kernel
}

const writeProgram = (kernel: Kernel, name: string, source: string) => {
        kernel.writeFileSync(`/bin/${name}`, `${source}\n`, { mode: 0o755 })
}

describe('Kernel environment', () => {
        test('provides default PATH', () => {
                const kernel = new Kernel()
                assertEqual(kernel.getEnv('PATH'), '/bin', 'Expected PATH to default to /bin')
        })

        test('supports setting and retrieving environment variables', () => {
                const kernel = new Kernel()
                kernel.setEnv('FOO', 'bar')
                assertEqual(kernel.getEnv('FOO'), 'bar')
                assertEqual(kernel.getEnv('MISSING'), '')
        })
})

describe('Executable resolution', () => {
        test('resolves executables from PATH entries', () => {
                const kernel = createKernel()
                writeProgram(kernel, 'hello', 'processController.exit(0)')
                const resolved = kernel.resolveExecutable('hello', '/')
                assertEqual(resolved, '/bin/hello')
        })

        test('resolves relative paths against current working directory', () => {
                const kernel = createKernel()
                kernel.mkdirSync('/usr/local/bin', { mode: 0o755, recursive: true })
                kernel.writeFileSync('/usr/local/bin/script', 'processController.exit(0)\n', {
                        mode: 0o755,
                })
                const resolved = kernel.resolveExecutable('./bin/script', '/usr/local')
                assertEqual(resolved, '/usr/local/bin/script')
        })

        test('throws when absolute path is missing', () => {
                const kernel = createKernel()
                let threw = false
                try {
                        kernel.resolveExecutable('/missing/tool', '/')
                } catch (error) {
                        threw = error instanceof Error && error.message.includes('Executable not found')
                }
                assert(threw, 'Expected resolveExecutable to throw for missing absolute path')
        })
})

describe('Process spawning', () => {
        test('returns ExitCode.NOT_FOUND for missing programs', () => {
                const kernel = createKernel()
                const result = kernel.spawn({
                        argv: ['missing'],
                        env: {},
                        cwd: '/',
                        name: 'missing',
                })
                assertEqual(result, ExitCode.NOT_FOUND)
        })

        test('executes programs with piped stdio', async () => {
                const kernel = createKernel()
                writeProgram(
                        kernel,
                        'stdio-test',
                        [
                                "const stdout = processController.stdout",
                                "const stderr = processController.stderr",
                                "stdout.write('out-' + processController.argv().join(','))",
                                "stderr.write('err-' + processController.getEnv('TEST_VAR'))",
                                'processController.exit(0)',
                        ].join('\n')
                )

                const subprocess = kernel.spawn({
                        argv: ['stdio-test', 'a', 'b'],
                        env: { TEST_VAR: 'value' },
                        cwd: '/',
                        name: 'stdio-test',
                        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
                })

                assert(typeof subprocess !== 'number', 'Expected spawn to return subprocess')
                const stdoutPromise = collectStream(subprocess.stdout)
                const stderrPromise = collectStream(subprocess.stderr)
                const exitCode = await waitForExit(subprocess)

                const stdout = await stdoutPromise
                const stderr = await stderrPromise

                assertEqual(exitCode, ExitCode.OK)
                assertEqual(stdout, 'out-stdio-test,a,b')
                assertEqual(stderr, 'err-value')
        })

        test('supports BusyBox programs end-to-end', async () => {
                const kernel = createKernel()
                installBusybox(kernel)

                const subprocess = kernel.spawn({
                        argv: ['echo', 'hello', 'kernel'],
                        env: {},
                        cwd: '/',
                        name: 'echo',
                        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
                })

                assert(typeof subprocess !== 'number', 'Expected spawn to return subprocess')
                const stdoutPromise = collectStream(subprocess.stdout)
                const exitCode = await waitForExit(subprocess)
                const stdout = await stdoutPromise

                assertEqual(exitCode, ExitCode.OK)
                assertEqual(stdout.trim(), 'hello kernel')
        })

        test('propagates environment and cwd to child process', async () => {
                const kernel = createKernel()
                writeProgram(
                        kernel,
                        'env-check',
                        [
                                "const stdout = processController.stdout",
                                "stdout.write(JSON.stringify({",
                                "  cwd: processController.cwd(),",
                                "  env: processController.getEnv('CUSTOM'),",
                                "  argv: processController.argv(),",
                                "}))",
                                'processController.exit(0)',
                        ].join('\n')
                )

                const subprocess = kernel.spawn({
                        argv: ['env-check', 'x'],
                        env: { CUSTOM: 'yes' },
                        cwd: '/workspace',
                        name: 'env-check',
                        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
                })

                assert(typeof subprocess !== 'number', 'Expected spawn to return subprocess')
                const stdoutPromise = collectStream(subprocess.stdout)
                const exitCode = await waitForExit(subprocess)
                const stdout = await stdoutPromise

                assertEqual(exitCode, ExitCode.OK)
                const parsed = JSON.parse(stdout)
                assertEqual(parsed.cwd, '/workspace')
                assertEqual(parsed.env, 'yes')
                assertArrayIncludes(parsed.argv, 'env-check')
                assertArrayIncludes(parsed.argv, 'x')
        })

        test('kernel.kill terminates running processes', async () => {
                const kernel = createKernel()
                writeProgram(
                        kernel,
                        'never-exit',
                        [
                                'setInterval(() => {}, 1000)',
                                'processController.stdout.write("ready")',
                        ].join('\n')
                )

                const subprocess = kernel.spawn({
                        argv: ['never-exit'],
                        env: {},
                        cwd: '/',
                        name: 'never-exit',
                        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
                })

                assert(typeof subprocess !== 'number', 'Expected spawn to return subprocess')
                await waitForFirstChunk(subprocess.stdout)
                const killed = kernel.kill(subprocess.pid)
                assert(killed, 'Expected kernel.kill to succeed')
                const exitCode = await waitForExit(subprocess)
                assertEqual(exitCode, ExitCode.ERROR)
        })

        test('listProcesses reports active kernel hosted processes', async () => {
                const kernel = createKernel()
                writeProgram(kernel, 'short', 'processController.exit(0)')
                const subprocess = kernel.spawn({
                        argv: ['short'],
                        env: {},
                        cwd: '/',
                        name: 'short',
                        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
                })
                assert(typeof subprocess !== 'number', 'Expected spawn to return subprocess')

                const listed = kernel.listProcesses()
                const pids = listed.map((process) => process.pid)
                assertArrayIncludes(pids, subprocess.pid)

                await waitForExit(subprocess)
                await wait(10)
                const after = kernel.listProcesses()
                const afterPids = after.map((process) => process.pid)
                assert(!afterPids.includes(subprocess.pid), 'Process should be removed after exit')
        })
})
