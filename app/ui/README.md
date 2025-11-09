# Kernel File Browser UI

A browser-based file browser, code editor, and terminal interface for the JavaScript kernel.

## Components

### File Browser (`file-browser.ts`)
- Tree-based file navigation
- Supports directory expansion/collapse
- Click to select and open files
- Sorted display (directories first, then files)

### Code Editor (`code-editor.ts`)
- Built on CodeMirror 6
- Syntax highlighting for multiple languages:
  - JavaScript/TypeScript (.js, .jsx, .ts, .tsx)
  - JSON (.json)
  - CSS (.css)
  - HTML (.html, .htm)
  - Markdown (.md, .markdown)
- Auto-save on change (1.5s debounce)
- Cmd/Ctrl+S for manual save
- Line numbers, code folding, bracket matching
- Search, autocomplete, and more

### Terminal (`terminal.ts`)
- Interactive terminal interface
- Command history (arrow up/down)
- Connected to the kernel's shell (tty-shell)
- Displays stdout/stderr from kernel processes

### Kernel Filesystem Adapter (`kernel-filesystem.ts`)
- Async filesystem interface
- Works with both direct kernel access and worker-based proxy
- Supports all basic file operations:
  - Read/write files
  - List directories
  - Create/delete files and folders

### Kernel Proxy (`kernel-proxy.ts`)
- Message-passing proxy for communicating with kernel in a Web Worker
- Converts synchronous kernel calls to async RPC-style messages
- Handles responses and errors

## Architecture

```
index.html (Main Thread)
    ↓
  Worker (main-app.ts)
    ↓
  Kernel Instance
```

The kernel runs in a Web Worker for isolation. The UI communicates with it via message passing:
- UI → Worker: `kernel-request` messages with method name and args
- Worker → UI: `kernel-response` messages with results or errors
- Worker → UI: `stdout`, `stderr`, `exit` messages for terminal output

## Usage

Open `index.html` in a browser. The UI will:
1. Start the kernel worker
2. Initialize the file browser at root (`/`)
3. Connect the terminal to the running shell
4. Enable file editing with auto-save

## Styling

All styles are in `styles.css`. The design features:
- GitHub-inspired color scheme
- Responsive layout
- Monospace fonts for code and file paths
- Clean, minimal interface

## Integration

The UI is integrated into main-app.ts by adding a message handler for `kernel-request` events. This allows the UI to call kernel methods like:
- `readFileSync()`
- `writeFileSync()`
- `readdirSync()`
- `statSync()`
- `existsSync()`
- `mkdirSync()`
- `unlinkSync()`
- `rmdirSync()`
