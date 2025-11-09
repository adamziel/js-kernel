# Flash WebAssembly Parser Demo

This demo compiles the Flash shell parser to WebAssembly, allowing you to parse shell code directly in the browser.

**[Flash on GitHub](https://github.com/raphamorim/flash)**

## Features

- **Live Parsing**: Input shell code on the left, see the parsed AST on the right
- **Real-time Updates**: Parse code with Ctrl+Enter or the Parse button
- **Example Code**: Click on examples to quickly test different shell constructs
- **Error Handling**: Clear error messages for invalid syntax

## Building the Package

### Prerequisites

**Required:**

1. **Rust toolchain** - Install from [rustup.rs](https://rustup.rs/)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

**Auto-installed by `npm run build`:**

2. **wasm-pack** - WebAssembly build tool (auto-installed if missing)
   ```bash
   cargo install wasm-pack
   ```

3. **wasm32-unknown-unknown target** (auto-installed if missing)
   ```bash
   rustup target add wasm32-unknown-unknown
   ```

**Optional:**

4. **wasm-opt** - For optimal binary size (recommended)
   ```bash
   # macOS
   brew install binaryen

   # Linux
   apt-get install binaryen
   ```

### Build Commands

#### Using NPM (Recommended)

From this directory:

```bash
# Check if all dependencies are installed
npm run check-deps

# Build the package (auto-installs wasm-pack if needed)
npm run build

# Clean and rebuild
npm run rebuild

# Clean build artifacts
npm run clean
```

The `npm run build` command will:
- ✅ Check if Rust is installed (exits with helpful message if not)
- ✅ Auto-install `wasm-pack` if missing
- ✅ Auto-install `wasm32-unknown-unknown` target if missing
- ✅ Build the WebAssembly package

#### Using wasm-pack directly

```bash
# Build the WebAssembly package
wasm-pack build --target web --out-dir pkg

# Clean before rebuilding
cargo clean && wasm-pack build --target web --out-dir pkg
```

**Build output:**
```
Compiling flash v0.0.6 (playground-projects/shell-parser/flash)
Compiling flash-wasm-demo v0.1.0
Finished `release` profile [optimized] target(s) in 5.99s
✨ Done in 6.43s
```

### Generated Files

After building, the `pkg/` directory contains:

- `flash_wasm_demo.js` - JavaScript bindings (~9.4KB)
- `flash_wasm_demo_bg.wasm` - Compiled WebAssembly binary (~140KB optimized)
- `flash_wasm_demo.d.ts` - TypeScript type definitions
- `flash_wasm_demo_bg.wasm.d.ts` - TypeScript types for WASM module
- `package.json` - NPM package metadata
- `README.md` - Package usage documentation

### Dependencies

This package uses:
- **`flash`** - Local source from `../../../../../../../playground-projects/shell-parser/flash`
  - Shell parser library with Bash support
  - Built with `default-features = false` for minimal WASM size (no interpreter/formatter)
- `wasm-bindgen = "0.2"` - Rust/JavaScript interop layer
- `serde` + `serde-wasm-bindgen` - Serialization for ParseResult struct
- `web-sys` - Web API bindings (console logging)

### Available NPM Scripts

- `npm run check-deps` - Check if all required dependencies are installed
- `npm run build` - Build the WASM package (auto-installs missing tools)
- `npm run build:release` - Build with release optimizations
- `npm run rebuild` - Clean and rebuild from scratch
- `npm run clean` - Remove build artifacts

### Troubleshooting

**"Rust is not installed" error:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
npm run build
```

**Build is slow or times out:**
- First build takes longer as it downloads and compiles dependencies
- Subsequent builds are much faster due to caching
- Consider using `npm run build:release` for production builds

**WASM file is larger than expected:**
- Install wasm-opt for better optimization: `brew install binaryen`
- The auto-installed wasm-pack will use wasm-opt if available

## Supported Shell Constructs

The demo can parse various shell constructs including:

- Simple commands: `ls -la`
- Pipelines: `ls | grep test`
- Redirections: `echo "hello" > file.txt`
- Variable assignments: `VAR=value`
- Command substitution: `echo $(date)`
- Arithmetic expansion: `echo $((2 + 2))`
- Conditional statements: `if [ condition ]; then ...; fi`
- Loops: `for i in {1..10}; do ...; done`
- Functions: `function name() { ...; }`
- And more!

## Architecture

- **Rust Library**: The core Flash parser compiled to WebAssembly
- **JavaScript Interface**: Wasm-bindgen provides the JS/WASM bridge
- **Web Interface**: Clean two-panel layout for input and output

The WebAssembly module exposes a `parse_shell_code` function that takes shell code as input and returns a structured representation of the parsed AST.