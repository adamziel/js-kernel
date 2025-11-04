# Flash WebAssembly Parser

WebAssembly build of the Flash shell parser. Parse shell/Bash code directly in the browser or Node.js.

**[Flash on GitHub](https://github.com/raphamorim/flash)**

## Installation

### Direct Usage

Copy the files from this directory to your web project:
- `flash_wasm_demo.js`
- `flash_wasm_demo_bg.wasm`
- `flash_wasm_demo.d.ts` (optional, for TypeScript)

### NPM (if published)

```bash
npm install flash-wasm-demo
```

## Usage

### Browser (ES Modules)

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Flash Parser Demo</title>
</head>
<body>
    <script type="module">
        import init, { parse_shell_code } from './flash_wasm_demo.js';

        async function run() {
            // Initialize the WASM module
            await init();

            // Parse shell code
            const result = parse_shell_code('echo "Hello, World!" | grep Hello');

            console.log('Success:', result.success);
            if (result.success) {
                console.log('AST:', result.ast);
            } else {
                console.error('Error:', result.error);
            }
        }

        run();
    </script>
</body>
</html>
```

### TypeScript

```typescript
import init, { parse_shell_code } from './flash_wasm_demo';

interface ParseResult {
    success: boolean;
    ast: string;
    error?: string;
}

async function parseShell(code: string): Promise<ParseResult> {
    await init();
    return parse_shell_code(code);
}

// Usage
const result = await parseShell('ls -la | grep .rs');
if (result.success) {
    console.log('Parsed AST:', result.ast);
} else {
    console.error('Parse error:', result.error);
}
```

### Node.js

```javascript
const { parse_shell_code } = require('./flash_wasm_demo.js');

// Parse shell code
const result = parse_shell_code('echo $((2 + 2))');
console.log(result);
```

## API

### `parse_shell_code(input: string): ParseResult`

Parses shell code and returns the Abstract Syntax Tree (AST) in JSON format.

**Parameters:**
- `input` - Shell code string to parse

**Returns:** `ParseResult` object
```typescript
{
    success: boolean;   // true if parsing succeeded
    ast: string;        // JSON-formatted AST structure
    error?: string;     // Error message if parsing failed
}
```

**Example:**
```javascript
const result = parse_shell_code('if [ -f file.txt ]; then cat file.txt; fi');

// Success case
{
    success: true,
    ast: '{"type": "Script", ...}', // Full AST as JSON
    error: undefined
}

// Error case
{
    success: false,
    ast: "",
    error: "Unexpected token at line 1, column 5"
}
```

## Supported Shell Constructs

The parser supports various shell/Bash constructs:

- **Simple commands**: `ls -la`, `echo hello`
- **Pipelines**: `cat file.txt | grep pattern | wc -l`
- **Redirections**: `echo "text" > file.txt`, `cat < input.txt`
- **Variables**: `VAR=value`, `echo $VAR`
- **Command substitution**: `` echo `date` ``, `echo $(pwd)`
- **Arithmetic expansion**: `echo $((2 + 2))`
- **Conditionals**: `if [ -f file ]; then ...; fi`
- **Loops**: `for i in {1..10}; do echo $i; done`, `while true; do ...; done`
- **Functions**: `function name() { ...; }`, `name() { ...; }`
- **Case statements**: `case $var in pattern) ... ;; esac`
- **Logical operators**: `&&`, `||`, `!`
- **Background jobs**: `command &`
- **Subshells**: `(command1; command2)`

## File Information

- **JavaScript**: ~9.4KB
- **WebAssembly**: ~140KB (optimized with serde support for JSON output)
- **Target**: `web` (browser ES modules)
- **Features**: Parser with JSON serialization (no interpreter/formatter)

## Build Information

Built from local Flash source at `playground-projects/shell-parser/flash`:
- Compiled with `default-features = false` for minimal size
- Includes serde support for JSON AST output
- Optimized with wasm-opt

To rebuild: see parent directory README.md

## License

GPL-3.0-or-later (inherits from Flash parser)
