#!/bin/bash

set -e

echo "Building WASMFS module with OPFS backend..."

# Output directory
mkdir -p /src/dist

# Compilation flags:
# -sWASMFS=1                    Enable WASMFS
# -sFORCE_FILESYSTEM=1          Export full FS API to JavaScript
# -pthread                      Enable pthreads (required for OPFS with SharedArrayBuffer)
# -sPROXY_TO_PTHREAD=1          Proxy main thread to pthread
# -sEXPORT_ES6=1                Export as ES6 module
# -sEXPORTED_RUNTIME_METHODS    Export FS object and other utilities
# -sALLOW_MEMORY_GROWTH=1       Allow dynamic memory growth
# -sINITIAL_MEMORY=64MB         Set initial memory size
# -sSTACK_SIZE=5MB              Set stack size
# -sPTHREAD_POOL_SIZE=4         Create a pool of 4 worker threads
# -sEXPORTED_FUNCTIONS          Export specific C functions
# -O2                           Optimization level 2
# -g                            Include debug information
# -sASSERTIONS=1                Enable runtime assertions

emcc wasmfs-fs.c \
  -o /src/dist/wasmfs-fs.js \
  -sWASMFS=1 \
  -sFORCE_FILESYSTEM=1 \
  -pthread \
  -sWASM_BIGINT \
  -sEXPORT_ES6=1 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createWasmFSModule \
  -sEXPORTED_RUNTIME_METHODS='["FS","ERRNO_CODES","allocateUTF8","UTF8ToString","stringToUTF8","lengthBytesUTF8"]' \
  -sINITIAL_MEMORY=67108864 \
  -sSTACK_SIZE=5242880 \
  -sPTHREAD_POOL_SIZE=2 \
  -sEXPORTED_FUNCTIONS='["_fs_init","_fs_open","_fs_close","_fs_read","_fs_write","_fs_lseek","_fs_fsync","_fs_fdatasync","_fs_fstat","_fs_stat","_fs_lstat","_fs_mkdir","_fs_rmdir","_fs_unlink","_fs_rename","_fs_chmod","_fs_fchmod","_fs_truncate","_fs_ftruncate","_fs_access","_fs_getcwd","_fs_chdir","_fs_symlink","_fs_readlink","_fs_get_errno","_fs_test","_malloc","_free"]' \
  -O2 \
  -g \
  -sASSERTIONS=1 \
  -sENVIRONMENT=worker

echo "Build complete!"

# Patch for Vite compatibility
echo ""
echo "Patching for Vite compatibility..."
sed -i 's/new Worker(new URL/new Worker(\/* @vite-ignore *\/ new URL/g' /src/dist/wasmfs-fs.js
sed -i 's/import\.meta\.url), {/import.meta.url), \/* @vite-ignore *\/ {/g' /src/dist/wasmfs-fs.js
echo "Patching complete!"

echo ""
echo "Output files:"
ls -lh /src/dist/

echo ""
echo "Generated files:"
echo "  - wasmfs-fs.js       Main JavaScript module"
echo "  - wasmfs-fs.wasm     WebAssembly binary"
echo "  - wasmfs-fs.worker.js Worker thread script"
