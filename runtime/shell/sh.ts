/**
 * Flash shell parser: https://github.com/raphamorim/flash

Parses shell code such as this:
```
ls -la "hey a a" hey d -- de jw rj > yp.xt | grep test
```

To AST:

List {
    statements: [
        Pipeline {
            commands: [
                Command {
                    name: "ls",
                    args: [
                        "-la",
                        "hey a a",
                        "hey",
                        "d",
                        "--",
                        "de",
                        "jw",
                        "rj",
                    ],
                    redirects: [
                        Redirect {
                            kind: Output,
                            file: "yp.xt",
                        },
                    ],
                },
                Command {
                    name: "grep",
                    args: [
                        "test",
                    ],
                    redirects: [],
                },
            ],
        },
    ],
    operators: [],
}
 */
import type { Node } from './ast.ts';

import wasmModule, { parse_shell_code } from './flash/pkg/flash_wasm_demo.js';

export function parseShellCode(input: string): Node {
	const out = parse_shell_code(input);
	if (!out.success) {
		throw new Error(`Failed to parse shell code: ${out.error}`);
	}
	return JSON.parse(out.ast) as Node;
}

await wasmModule();