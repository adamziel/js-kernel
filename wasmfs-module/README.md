# WASMFS Module with OPFS Backend

A WebAssembly module built with Emscripten's WASMFS that provides a POSIX-like filesystem interface using Origin Private File System (OPFS) as the storage backend. Uses SharedArrayBuffer for multi-threaded operations.

## What Was Built

This module exports a complete filesystem API to JavaScript, allowing you to:
- Perform file I/O operations (open, read, write, close, seek)
- Manage directories (mkdir, rmdir, chdir, getcwd)
- Handle file metadata (stat, chmod, access)
- Create symbolic links
- All operations use OPFS for persistent storage

## Files Generated

- `wasmfs-fs.wasm` - WebAssembly binary (3.6 MB)
- `wasmfs-fs.js` - ES6 module loader (143 KB)
- `wasmfs-fs.worker.js` - Web Worker for pthread support (auto-generated)

## Technical Details

### Compilation Flags Used

- `-sWASMFS=1` - Enable WASMFS filesystem
- `-sFORCE_FILESYSTEM=1` - Export full FS API to JavaScript
- `-pthread` - Enable pthread support (required for OPFS)
- `-sPROXY_TO_PTHREAD=1` - Proxy main thread to pthread
- `-sEXPORT_ES6=1` - Export as ES6 module
- `-sALLOW_MEMORY_GROWTH=1` - Dynamic memory growth
- `-sPTHREAD_POOL_SIZE=4` - Pre-allocate 4 worker threads

### Exported Functions

#### Initialization
- `fs_init()` - Initialize OPFS backend (must be called first)

#### File Operations
- `fs_open(path, flags, mode)` - Open a file
- `fs_close(fd)` - Close a file descriptor
- `fs_read(fd, buffer, count)` - Read from file
- `fs_write(fd, buffer, count)` - Write to file
- `fs_lseek(fd, offset, whence)` - Seek in file
- `fs_fsync(fd)` - Sync file to disk
- `fs_fdatasync(fd)` - Sync file data to disk
- `fs_fstat(fd, stat_buf)` - Get file stats by descriptor
- `fs_stat(path, stat_buf)` - Get file stats by path
- `fs_lstat(path, stat_buf)` - Get link stats
- `fs_truncate(path, length)` - Truncate file
- `fs_ftruncate(fd, length)` - Truncate file by descriptor

#### Directory Operations
- `fs_mkdir(path, mode)` - Create directory
- `fs_rmdir(path)` - Remove directory
- `fs_chdir(path)` - Change working directory
- `fs_getcwd(buffer, size)` - Get current working directory

#### Path Operations
- `fs_unlink(path)` - Delete a file
- `fs_rename(oldpath, newpath)` - Rename/move file
- `fs_chmod(path, mode)` - Change file permissions
- `fs_fchmod(fd, mode)` - Change file permissions by descriptor
- `fs_access(path, mode)` - Check file accessibility
- `fs_symlink(target, linkpath)` - Create symbolic link
- `fs_readlink(path, buffer, size)` - Read symbolic link

#### Utility
- `fs_get_errno()` - Get last error code
- `fs_test()` - Run built-in test suite

### Runtime Requirements

- Module.FS - Emscripten filesystem API
- Module.ERRNO_CODES - Error code constants
- Module.UTF8ToString() - Convert C string to JS
- Module.stringToUTF8() - Convert JS string to C
- Module.lengthBytesUTF8() - Get UTF8 string byte length
- Module._malloc() / Module._free() - Memory allocation

## Browser Requirements

### SharedArrayBuffer Support

SharedArrayBuffer requires these HTTP headers:
```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

### OPFS Support

OPFS is available in:
- Chrome/Edge 86+
- Firefox 111+
- Safari 15.2+

Check with:
```javascript
if ('storage' in navigator && 'getDirectory' in navigator.storage) {
  console.log('OPFS is supported');
}
```

## Usage Example

```javascript
// Import the module
import createWasmFSModule from './dist/wasmfs-fs.js';

// Create instance
const Module = await createWasmFSModule();

// Initialize OPFS backend
const result = Module._fs_init();
if (result !== 0) {
  throw new Error('Failed to initialize filesystem');
}

// Create a directory
const mode = 0o777;
Module._fs_mkdir('/opfs/mydir', mode);

// Open a file
const O_RDWR = 2;
const O_CREAT = 0x0200;
const fd = Module._fs_open('/opfs/mydir/test.txt', O_RDWR | O_CREAT, 0o666);

// Write to file
const text = 'Hello, WASMFS!';
const textPtr = Module._malloc(text.length + 1);
Module.stringToUTF8(text, textPtr, text.length + 1);
Module._fs_write(fd, textPtr, text.length);
Module._free(textPtr);

// Sync to disk
Module._fs_fdatasync(fd);

// Close file
Module._fs_close(fd);

// Read back
const readFd = Module._fs_open('/opfs/mydir/test.txt', 2, 0);
const bufSize = 100;
const bufPtr = Module._malloc(bufSize);
const bytesRead = Module._fs_read(readFd, bufPtr, bufSize);
const content = Module.UTF8ToString(bufPtr);
console.log('Read:', content);
Module._free(bufPtr);
Module._fs_close(readFd);
```

## Testing

Open `test.html` in a web browser with proper headers to test the module:

```bash
# Using Python's http.server with custom headers
python3 -m http.server 8000 --bind localhost
```

Then configure your web server to send the required COOP/COEP headers.

## Building from Source

```bash
# Build the Docker image
docker build -t wasmfs-builder .

# Compile the module
docker run --rm -v "$(pwd)/dist:/src/dist" wasmfs-builder
```

## Next Steps

For your goal of loading this module in every worker:

1. **Import in Workers**: Each worker can import the ES6 module
2. **Shared Memory**: The SharedArrayBuffer allows the workers to share memory
3. **Local Filesystem**: Each worker can call the filesystem functions directly without message passing
4. **OPFS Backend**: All workers will access the same persistent storage through OPFS

### Multi-Worker Setup Example

```javascript
// In each worker
import createWasmFSModule from './dist/wasmfs-fs.js';

const Module = await createWasmFSModule();
Module._fs_init();

// Now this worker can use the filesystem directly
// No message passing needed!
```

## Performance Notes

- The `-pthread + ALLOW_MEMORY_GROWTH` combination may run slower than fixed memory
- Consider removing `-sALLOW_MEMORY_GROWTH=1` and setting a fixed `-sINITIAL_MEMORY` size for production
- Debug info is included (`-g`); remove for smaller builds

## Known Issues

- Platform mismatch warning (linux/amd64 vs linux/arm64) is cosmetic and can be ignored
- Some JS library symbols are deprecated but still functional

## License

Same as the parent project.
