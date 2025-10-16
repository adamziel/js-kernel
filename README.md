# Kernel Runtime Sandbox

A browser-based kernel sandbox that mirrors a small POSIX-like environment using Web Workers. It powers the interactive BusyBox style utilities, process orchestration, and shell that ship with the Playground runtime.

Example usage:

```js
import { installBusybox } from '../runtime/busybox/index.ts'
import { installPhpInterpreter } from './programs/php-interpreter.ts'
import { Kernel } from '../runtime/index.ts'

const kernel = new Kernel()
installBusybox(kernel)

// Simple shell scripts are parsed, each command is implemented as a separate
// TypeScript module and executed in a separate process with a pipe between
// their stdio.
kernel.writeFileSync(
	`/my-script.sh`,
	`
   echo "Hello, world from a script!" | cat
   touch /new-file.txt
   `,
	{ mode: 0o755 }
)
await runProgram(['sh', '/my-script.sh'])

// All processes share the same filesystem so we'll see the `new-file.txt`
// in the output.
console.log(kernel.readdirSync('/', 'utf8'))

// Custom interperters are supported
installPhpInterpreter(kernel)
kernel.writeFileSync(`/my-script.php`, `<?php echo "Hello from PHP!"; ?>`, {
	mode: 0o755,
})
await runProgram(['php', '/my-script.php'])

// Helper function to run a program with a single line of code
function runProgram(argv: string[]) {
	const worker = kernel.spawn({
		argv,
		env: {},
		cwd: '/',
		name: 'shell',
		debug: true,
	})
	if (typeof worker === 'number') {
		throw new Error('Failed to spawn program')
	}

	return new Promise((resolve) => {
		worker.onExit((code) => {
			resolve(code)
		})
	})
}
```

## High-Level Architecture

- **App (`app/`)** – Vite-powered entrypoint that boots a worker-based kernel, installs bundled BusyBox programs, and drives demos or playground code.
- **Runtime (`runtime/`)** – The core platform code:
  - `core/` implements the kernel, in-memory filesystem, and process registry.
  - `process/` manages worker lifecycles, stdio plumbing over `MessagePort`s, synchronous spawn bridges, and filesystem RPC.
  - `shell/` provides a parser (via Flash) plus an execution engine that can pipeline commands, forward stdio, and respect redirects.
  - `busybox/` contains individual command programs, each compiled to strings and injected into the virtual filesystem.
- **Shared Utilities** – Helpers for path normalization, serialized message formats, and pump workers that move data between the host and child processes.

## How It Works

1. The kernel exposes a POSIX-flavored API (`processController`) to child workers: spawn, exit, env, stdio, and filesystem methods.
2. BusyBox programs are emitted as plain JavaScript sources and written into `/bin`. When invoked, they run inside isolated workers, reporting results through message channels.
3. The shell parses user input into a Flash AST, resolves each node into command executions, and orchestrates pipes or redirects by wiring `MessagePortReadableStream`/`MessagePortWritableStream` instances.
4. All filesystem calls resolve into the in-memory FS, with sync and async bridges handled by a shared pump worker so that synchronous APIs stay responsive.

## Getting Started

1. Install dependencies from the project root:

   ```bash
   npm install
   ```

2. Launch the Vite dev server for the kernel sandbox:
   ```bash
   npm run dev
   ```
   The server opens `app/index.html`, which spins up the kernel worker and runs the sample scripts.

## Testing

Kernel functionality is exercised entirely in the browser so that worker orchestration, stdio plumbing, and the in-memory
filesystem behave exactly as they do in production. To run the automated suite:

1. Start the dev server and open the dedicated runner page:
   ```bash
   npm run test:browser
   ```
   The server will serve `app/tests/index.html`, which lists every test and streams live results.
2. Alternatively, run `npm run dev` and visit `http://localhost:5173/tests/` manually if you prefer to keep the regular
   playground open.

The runner will log results in both the browser and the developer console. Failed tests include stack traces for easier
debugging, and completed runs expose `window.__kernelTestsComplete = true` so browser automation can await the final state.

## Project Structure

```
app/                     # Custom app built on top of the kernel
runtime/
  core/                  # Kernel implementation
  process/               # Process workers, spawn options, IPC plumbing
  busybox/               # Command sources (cat, ls, sh, etc.)
  shell/                 # Flash parser bindings and execution engine
  ipc/                   # Shared sync pump worker + message streams
README.md
vite.config.ts           # Vite setup scoped to this package
```

## Development Notes

- BusyBox programs are authored as TypeScript modules that export source-string factories. Keep runtime work minimal and use `runtime/busybox/lib/utils.ts` helpers for argument parsing, stdout/stderr, and exits.
- Pipelines are wired via message ports; if you add new programs with custom stdio requirements, reuse the helpers in `runtime/shell/run.ts`.
- The kernel’s filesystem is purely in-memory. Persisting state or adding host-backed storage requires extending `runtime/core/kernel.ts` together with the filesystem serialization utilities.
- For shell enhancements, update the Flash parser bindings in `runtime/shell/sh.ts` and the execution logic in `runtime/shell/run.ts`.

## Further Reading

See `app/main-app.ts` for an end-to-end example that boots the kernel, installs BusyBox, and runs demo commands.
