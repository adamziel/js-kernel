import { describe, it, expect, beforeAll } from 'vitest';

// Type definitions for the WASM module
interface WasmFSModule {
  // Core exports
  _fs_init: () => number;
  _fs_test: () => number;
  _fs_get_errno: () => number;

  // File operations
  _fs_open: (path: number, flags: number, mode: number) => number;
  _fs_close: (fd: number) => number;
  _fs_read: (fd: number, buf: number, count: number) => number;
  _fs_write: (fd: number, buf: number, count: number) => number;
  _fs_lseek: (fd: number, offset: number, whence: number) => number;
  _fs_fsync: (fd: number) => number;
  _fs_fdatasync: (fd: number) => number;
  _fs_fstat: (fd: number, statbuf: number) => number;
  _fs_stat: (path: number, statbuf: number) => number;
  _fs_lstat: (path: number, statbuf: number) => number;
  _fs_truncate: (path: number, length: number) => number;
  _fs_ftruncate: (fd: number, length: number) => number;

  // Directory operations
  _fs_mkdir: (path: number, mode: number) => number;
  _fs_rmdir: (path: number) => number;
  _fs_chdir: (path: number) => number;
  _fs_getcwd: (buf: number, size: number) => number;

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
}

// File flags (POSIX standard)
const O_RDONLY = 0;
const O_WRONLY = 1;
const O_RDWR = 2;
const O_CREAT = 0x0200;
const O_EXCL = 0x0800;
const O_TRUNC = 0x0400;
const O_APPEND = 0x0008;

// Seek whence values
const SEEK_SET = 0;
const SEEK_CUR = 1;
const SEEK_END = 2;

// Access modes
const F_OK = 0; // File exists
const R_OK = 4; // Read permission
const W_OK = 2; // Write permission
const X_OK = 1; // Execute permission

describe('WASMFS Module', () => {
  let Module: WasmFSModule;

  beforeAll(async () => {
    // Check browser capabilities
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer is not available. Check COOP/COEP headers.');
    }

    // Import the WASM module
    const createWasmFSModule = (
      await import('./wasmfs-dist/wasmfs-fs.js')
    ).default;

    // Create module instance
    Module = (await createWasmFSModule()) as unknown as WasmFSModule;

    // Initialize filesystem
    const result = Module._fs_init();
    expect(result).toBe(0);
  });

  // Helper function to allocate a C string
  function allocString(str: string): number {
    const len = Module.lengthBytesUTF8(str) + 1;
    const ptr = Module._malloc(len);
    Module.stringToUTF8(str, ptr, len);
    return ptr;
  }

  // Helper function to read a C string
  function readString(ptr: number): string {
    return Module.UTF8ToString(ptr);
  }

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      // Already initialized in beforeAll, just verify module exists
      expect(Module).toBeDefined();
      expect(Module._fs_init).toBeDefined();
    });

    it('should run built-in test successfully', () => {
      const result = Module._fs_test();
      expect(result).toBe(0);
    });

    it('should have OPFS mounted at /opfs', () => {
      const pathPtr = allocString('/opfs');
      const result = Module._fs_access(pathPtr, F_OK);
      Module._free(pathPtr);
      expect(result).toBe(0);
    });
  });

  describe('File Operations', () => {
    const testFile = '/opfs/test-file.txt';
    const testContent = 'Hello, WASMFS!';

    it('should create and open a new file', () => {
      const pathPtr = allocString(testFile);
      const fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      Module._free(pathPtr);

      expect(fd).toBeGreaterThan(0);
      Module._fs_close(fd);
    });

    it('should write data to a file', () => {
      const pathPtr = allocString(testFile);
      const fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      Module._free(pathPtr);

      const contentPtr = allocString(testContent);
      const bytesWritten = Module._fs_write(fd, contentPtr, testContent.length);
      Module._free(contentPtr);

      expect(bytesWritten).toBe(testContent.length);
      Module._fs_close(fd);
    });

    it('should read data from a file', () => {
      // First write
      const pathPtr = allocString(testFile);
      let fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      const contentPtr = allocString(testContent);
      Module._fs_write(fd, contentPtr, testContent.length);
      Module._free(contentPtr);
      Module._fs_close(fd);

      // Then read
      fd = Module._fs_open(pathPtr, O_RDONLY, 0);
      Module._free(pathPtr);

      const bufPtr = Module._malloc(100);
      const bytesRead = Module._fs_read(fd, bufPtr, 100);

      expect(bytesRead).toBe(testContent.length);

      const content = readString(bufPtr);
      expect(content).toBe(testContent);

      Module._free(bufPtr);
      Module._fs_close(fd);
    });

    it('should seek within a file', () => {
      const pathPtr = allocString(testFile);
      const fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      Module._free(pathPtr);

      const contentPtr = allocString(testContent);
      Module._fs_write(fd, contentPtr, testContent.length);
      Module._free(contentPtr);

      // Seek to beginning
      let offset = Module._fs_lseek(fd, 0, SEEK_SET);
      expect(offset).toBe(0);

      // Seek to end
      offset = Module._fs_lseek(fd, 0, SEEK_END);
      expect(offset).toBe(testContent.length);

      // Seek to middle
      offset = Module._fs_lseek(fd, 5, SEEK_SET);
      expect(offset).toBe(5);

      Module._fs_close(fd);
    });

    it('should sync file data to disk', () => {
      const pathPtr = allocString(testFile);
      const fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      Module._free(pathPtr);

      const contentPtr = allocString(testContent);
      Module._fs_write(fd, contentPtr, testContent.length);
      Module._free(contentPtr);

      const syncResult = Module._fs_fsync(fd);
      expect(syncResult).toBe(0);

      const datasyncResult = Module._fs_fdatasync(fd);
      expect(datasyncResult).toBe(0);

      Module._fs_close(fd);
    });

    it('should get file stats', () => {
      const pathPtr = allocString(testFile);
      const fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);

      const contentPtr = allocString(testContent);
      Module._fs_write(fd, contentPtr, testContent.length);
      Module._free(contentPtr);
      Module._fs_close(fd);

      // stat by path
      const statPtr = Module._malloc(128); // struct stat is typically smaller
      const statResult = Module._fs_stat(pathPtr, statPtr);
      Module._free(pathPtr);

      expect(statResult).toBe(0);
      Module._free(statPtr);
    });

    it('should truncate a file', () => {
      const pathPtr = allocString(testFile);
      const fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);

      const contentPtr = allocString(testContent);
      Module._fs_write(fd, contentPtr, testContent.length);
      Module._free(contentPtr);

      // Truncate to 5 bytes
      const truncResult = Module._fs_ftruncate(fd, 5);
      expect(truncResult).toBe(0);

      // Verify size
      const offset = Module._fs_lseek(fd, 0, SEEK_END);
      expect(offset).toBe(5);

      Module._fs_close(fd);
      Module._free(pathPtr);
    });

    it('should append to a file', () => {
      const pathPtr = allocString(testFile);
      let fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);

      const contentPtr = allocString('First ');
      Module._fs_write(fd, contentPtr, 6);
      Module._free(contentPtr);
      Module._fs_close(fd);

      // Open in append mode
      fd = Module._fs_open(pathPtr, O_WRONLY | O_APPEND, 0);
      const appendPtr = allocString('Second');
      Module._fs_write(fd, appendPtr, 6);
      Module._free(appendPtr);
      Module._fs_close(fd);

      // Read back
      fd = Module._fs_open(pathPtr, O_RDONLY, 0);
      const bufPtr = Module._malloc(100);
      const bytesRead = Module._fs_read(fd, bufPtr, 100);
      const content = readString(bufPtr);

      expect(content).toBe('First Second');

      Module._free(bufPtr);
      Module._fs_close(fd);
      Module._free(pathPtr);
    });

    it('should delete a file', () => {
      const pathPtr = allocString(testFile);
      const fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      Module._fs_close(fd);

      const unlinkResult = Module._fs_unlink(pathPtr);
      expect(unlinkResult).toBe(0);

      // Verify file is gone
      const accessResult = Module._fs_access(pathPtr, F_OK);
      expect(accessResult).toBe(-1);

      Module._free(pathPtr);
    });
  });

  describe('Directory Operations', () => {
    const testDir = '/opfs/test-directory';
    const nestedDir = '/opfs/test-directory/nested';

    it('should create a directory', () => {
      const pathPtr = allocString(testDir);
      const result = Module._fs_mkdir(pathPtr, 0o777);
      Module._free(pathPtr);

      expect(result).toBe(0);
    });

    it('should create nested directories', () => {
      const pathPtr = allocString(nestedDir);
      const result = Module._fs_mkdir(pathPtr, 0o777);
      Module._free(pathPtr);

      expect(result).toBe(0);
    });

    it('should change directory', () => {
      const pathPtr = allocString(testDir);
      const result = Module._fs_chdir(pathPtr);
      Module._free(pathPtr);

      expect(result).toBe(0);

      // Get current directory
      const cwdPtr = Module._malloc(256);
      const resultPtr = Module._fs_getcwd(cwdPtr, 256);
      expect(resultPtr).not.toBe(0);

      const cwd = readString(cwdPtr);
      expect(cwd).toContain('test-directory');

      Module._free(cwdPtr);

      // Change back to root
      const rootPtr = allocString('/opfs');
      Module._fs_chdir(rootPtr);
      Module._free(rootPtr);
    });

    it('should remove an empty directory', () => {
      const pathPtr = allocString(nestedDir);
      const result = Module._fs_rmdir(pathPtr);
      Module._free(pathPtr);

      expect(result).toBe(0);
    });

    it('should check directory accessibility', () => {
      const pathPtr = allocString(testDir);
      const result = Module._fs_access(pathPtr, F_OK);
      Module._free(pathPtr);

      expect(result).toBe(0);
    });

    it('should clean up test directory', () => {
      const pathPtr = allocString(testDir);
      Module._fs_rmdir(pathPtr);
      Module._free(pathPtr);
    });
  });

  describe('Path Operations', () => {
    const sourceFile = '/opfs/source.txt';
    const targetFile = '/opfs/target.txt';
    const linkFile = '/opfs/link.txt';

    it('should rename a file', () => {
      // Create source file
      const sourcePtr = allocString(sourceFile);
      const fd = Module._fs_open(sourcePtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      Module._fs_close(fd);

      // Rename
      const targetPtr = allocString(targetFile);
      const result = Module._fs_rename(sourcePtr, targetPtr);

      expect(result).toBe(0);

      // Verify source is gone
      const accessResult = Module._fs_access(sourcePtr, F_OK);
      expect(accessResult).toBe(-1);

      // Verify target exists
      const targetAccessResult = Module._fs_access(targetPtr, F_OK);
      expect(targetAccessResult).toBe(0);

      Module._free(sourcePtr);
      Module._free(targetPtr);
    });

    it('should change file permissions', () => {
      const pathPtr = allocString(targetFile);
      const result = Module._fs_chmod(pathPtr, 0o644);

      expect(result).toBe(0);

      Module._free(pathPtr);
    });

    it('should change file permissions by descriptor', () => {
      const pathPtr = allocString(targetFile);
      const fd = Module._fs_open(pathPtr, O_RDWR, 0);
      Module._free(pathPtr);

      const result = Module._fs_fchmod(fd, 0o666);
      expect(result).toBe(0);

      Module._fs_close(fd);
    });

    it('should create a symbolic link', () => {
      const targetPtr = allocString(targetFile);
      const linkPtr = allocString(linkFile);

      const result = Module._fs_symlink(targetPtr, linkPtr);

      // Symlinks might not be supported in all backends
      // So we check for success or ENOSYS
      if (result === 0) {
        expect(result).toBe(0);

        // Try to read the link
        const bufPtr = Module._malloc(256);
        const readResult = Module._fs_readlink(linkPtr, bufPtr, 256);

        if (readResult > 0) {
          const linkTarget = readString(bufPtr);
          expect(linkTarget).toBe(targetFile);
        }

        Module._free(bufPtr);
      } else {
        // Symlinks not supported, that's okay
        const errno = Module._fs_get_errno();
        console.log('Symlinks not supported, errno:', errno);
      }

      Module._free(targetPtr);
      Module._free(linkPtr);
    });

    it('should clean up test files', () => {
      const targetPtr = allocString(targetFile);
      Module._fs_unlink(targetPtr);
      Module._free(targetPtr);

      const linkPtr = allocString(linkFile);
      Module._fs_unlink(linkPtr); // Might fail if symlink wasn't created
      Module._free(linkPtr);
    });
  });

  describe('Error Handling', () => {
    it('should return error for non-existent file', () => {
      const pathPtr = allocString('/opfs/does-not-exist.txt');
      const fd = Module._fs_open(pathPtr, O_RDONLY, 0);
      Module._free(pathPtr);

      expect(fd).toBe(-1);

      const errno = Module._fs_get_errno();
      expect(errno).toBeGreaterThan(0);
    });

    it('should return error for invalid file descriptor', () => {
      const invalidFd = 99999;
      const result = Module._fs_close(invalidFd);

      expect(result).toBe(-1);
    });

    it('should return error when creating file with O_EXCL on existing file', () => {
      const pathPtr = allocString('/opfs/excl-test.txt');

      // Create file first
      const fd1 = Module._fs_open(pathPtr, O_RDWR | O_CREAT, 0o666);
      Module._fs_close(fd1);

      // Try to create again with O_EXCL
      const fd2 = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_EXCL, 0o666);
      expect(fd2).toBe(-1);

      // Clean up
      Module._fs_unlink(pathPtr);
      Module._free(pathPtr);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty file reads', () => {
      const pathPtr = allocString('/opfs/empty.txt');
      const fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      Module._free(pathPtr);

      const bufPtr = Module._malloc(100);
      const bytesRead = Module._fs_read(fd, bufPtr, 100);

      expect(bytesRead).toBe(0);

      Module._free(bufPtr);
      Module._fs_close(fd);
    });

    it('should handle zero-length writes', () => {
      const pathPtr = allocString('/opfs/zero-write.txt');
      const fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      Module._free(pathPtr);

      const bufPtr = Module._malloc(1);
      const bytesWritten = Module._fs_write(fd, bufPtr, 0);

      expect(bytesWritten).toBe(0);

      Module._free(bufPtr);
      Module._fs_close(fd);
    });

    it('should handle large files', () => {
      const pathPtr = allocString('/opfs/large.txt');
      const fd = Module._fs_open(pathPtr, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      Module._free(pathPtr);

      // Write 1MB of data
      const size = 1024 * 1024;
      const bufPtr = Module._malloc(size);

      // Fill buffer with pattern
      const view = new Uint8Array(Module.HEAP8.buffer, bufPtr, size);
      for (let i = 0; i < size; i++) {
        view[i] = i % 256;
      }

      const bytesWritten = Module._fs_write(fd, bufPtr, size);
      expect(bytesWritten).toBe(size);

      Module._fs_fdatasync(fd);

      // Seek back and verify
      Module._fs_lseek(fd, 0, SEEK_SET);
      const readBufPtr = Module._malloc(size);
      const bytesRead = Module._fs_read(fd, readBufPtr, size);

      expect(bytesRead).toBe(size);

      // Verify content
      const readView = new Uint8Array(Module.HEAP8.buffer, readBufPtr, size);
      for (let i = 0; i < Math.min(100, size); i++) {
        // Check first 100 bytes
        expect(readView[i]).toBe(i % 256);
      }

      Module._free(bufPtr);
      Module._free(readBufPtr);
      Module._fs_close(fd);
    });
  });
});
