// Worker script for running WASMFS tests
import type { WasmFSModule } from './wasmfs-types';

let Module: WasmFSModule;

// File flags (Linux/Emscripten standard values)
const O_RDONLY = 0;
const O_WRONLY = 1;
const O_RDWR = 2;
const O_CREAT = 0x40;    // 64 in decimal
const O_EXCL = 0x80;     // 128 in decimal
const O_TRUNC = 0x200;   // 512 in decimal
const O_APPEND = 0x400;  // 1024 in decimal

// Seek whence values
const SEEK_SET = 0;
const SEEK_CUR = 1;
const SEEK_END = 2;

// Helper functions
function allocString(str: string): number {
  const len = Module.lengthBytesUTF8(str) + 1;
  const ptr = Module._malloc(len);
  Module.stringToUTF8(str, ptr, len);
  return ptr;
}

function readString(ptr: number): string {
  return Module.UTF8ToString(ptr);
}

// Initialize the module
async function init() {
  try {
    const createWasmFSModule = (await import('./wasmfs-dist/wasmfs-fs.js')).default;
    Module = (await createWasmFSModule()) as unknown as WasmFSModule;

    const result = Module._fs_init();
    if (result !== 0) {
      throw new Error('Failed to initialize filesystem');
    }

    self.postMessage({ type: 'init', success: true });
  } catch (error: any) {
    self.postMessage({ type: 'init', success: false, error: error.message });
  }
}

// Handle messages from main thread
self.onmessage = async (e) => {
  const { command, args, id } = e.data;

  try {
    let result: any;

    switch (command) {
      case 'init':
        await init();
        return;

      case 'test_builtin':
        result = Module._fs_test();
        break;

      case 'open': {
        const pathPtr = allocString(args.path);
        result = Module._fs_open(pathPtr, args.flags, args.mode);
        Module._free(pathPtr);
        break;
      }

      case 'close':
        result = Module._fs_close(args.fd);
        break;

      case 'write': {
        const contentPtr = allocString(args.content);
        result = Module._fs_write(args.fd, contentPtr, args.content.length);
        Module._free(contentPtr);
        break;
      }

      case 'read': {
        const bufPtr = Module._malloc(args.size);
        const bytesRead = Module._fs_read(args.fd, bufPtr, args.size);
        const content = bytesRead > 0 ? readString(bufPtr) : '';
        Module._free(bufPtr);
        result = { bytesRead, content };
        break;
      }

      case 'lseek': {
        // lseek expects BigInt for offset with WASM_BIGINT
        const seekResult = Module._fs_lseek(args.fd, BigInt(args.offset), args.whence);
        result = Number(seekResult); // Convert BigInt result to number for postMessage
        break;
      }

      case 'fsync':
        result = Module._fs_fsync(args.fd);
        break;

      case 'mkdir': {
        const pathPtr = allocString(args.path);
        result = Module._fs_mkdir(pathPtr, args.mode);
        Module._free(pathPtr);
        break;
      }

      case 'rmdir': {
        const pathPtr = allocString(args.path);
        result = Module._fs_rmdir(pathPtr);
        Module._free(pathPtr);
        break;
      }

      case 'unlink': {
        const pathPtr = allocString(args.path);
        result = Module._fs_unlink(pathPtr);
        Module._free(pathPtr);
        break;
      }

      case 'rename': {
        const oldPtr = allocString(args.oldPath);
        const newPtr = allocString(args.newPath);
        result = Module._fs_rename(oldPtr, newPtr);
        Module._free(oldPtr);
        Module._free(newPtr);
        break;
      }

      case 'access': {
        const pathPtr = allocString(args.path);
        result = Module._fs_access(pathPtr, args.mode);
        Module._free(pathPtr);
        break;
      }

      case 'truncate': {
        const pathPtr = allocString(args.path);
        result = Module._fs_truncate(pathPtr, BigInt(args.length));
        Module._free(pathPtr);
        break;
      }

      case 'ftruncate':
        result = Module._fs_ftruncate(args.fd, BigInt(args.length));
        break;

      case 'chmod': {
        const pathPtr = allocString(args.path);
        result = Module._fs_chmod(pathPtr, args.mode);
        Module._free(pathPtr);
        break;
      }

      case 'readdir': {
        const pathPtr = allocString(args.path);
        const dirp = Module._fs_opendir(pathPtr);
        Module._free(pathPtr);

        if (dirp === 0) {
          throw new Error(`Failed to open directory: ${args.path}`);
        }

        const entries: string[] = [];
        try {
          while (true) {
            const direntPtr = Module._fs_readdir(dirp);
            if (direntPtr === 0) {
              break;
            }

            // Read d_name at offset 19
            const nameOffset = direntPtr + 19;
            const name = Module.UTF8ToString(nameOffset);

            if (name && name !== '.' && name !== '..') {
              entries.push(name);
            }
          }
        } finally {
          Module._fs_closedir(dirp);
        }

        result = entries;
        break;
      }

      case 'get_errno':
        result = Module._fs_get_errno();
        break;

      default:
        throw new Error(`Unknown command: ${command}`);
    }

    // Convert BigInt to Number for postMessage compatibility
    if (typeof result === 'bigint') {
      result = Number(result);
    }

    self.postMessage({ id, success: true, result });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || String(error);
    self.postMessage({ id, success: false, error: errorMessage });
  }
};

// Constants to export
export { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC, O_APPEND, SEEK_SET, SEEK_CUR, SEEK_END };
