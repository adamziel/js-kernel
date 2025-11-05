// Type definitions for the WASM module
export interface WasmFSModule {
  // Core exports
  _fs_init: () => number;
  _fs_test: () => number;
  _fs_get_errno: () => number;

  // File operations
  _fs_open: (path: number, flags: number, mode: number) => number;
  _fs_close: (fd: number) => number;
  _fs_read: (fd: number, buf: number, count: number) => number;
  _fs_write: (fd: number, buf: number, count: number) => number;
  _fs_lseek: (fd: number, offset: bigint, whence: number) => bigint;
  _fs_fsync: (fd: number) => number;
  _fs_fdatasync: (fd: number) => number;
  _fs_fstat: (fd: number, statbuf: number) => number;
  _fs_stat: (path: number, statbuf: number) => number;
  _fs_lstat: (path: number, statbuf: number) => number;
  _fs_truncate: (path: number, length: bigint) => number;
  _fs_ftruncate: (fd: number, length: bigint) => number;

  // Directory operations
  _fs_mkdir: (path: number, mode: number) => number;
  _fs_rmdir: (path: number) => number;
  _fs_chdir: (path: number) => number;
  _fs_getcwd: (buf: number, size: number) => number;
  _fs_opendir: (path: number) => number;
  _fs_readdir: (dirp: number) => number;
  _fs_closedir: (dirp: number) => number;

  // Path operations
  _fs_unlink: (path: number) => number;
  _fs_rename: (oldpath: number, newpath: number) => number;
  _fs_chmod: (path: number, mode: number) => number;
  _fs_fchmod: (fd: number, mode: number) => number;
  _fs_access: (path: number, mode: number) => number;
  _fs_symlink: (target: number, linkpath: number) => number;
  _fs_readlink: (path: number, buf: number, size: number) => number;

  // Memory management
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;

  // Utility functions
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string, ptr: number, maxBytesToWrite: number) => void;
  lengthBytesUTF8: (str: string) => number;

  // Emscripten FS API
  FS: any;
  ERRNO_CODES: Record<string, number>;
  HEAP8: Int8Array;
}
