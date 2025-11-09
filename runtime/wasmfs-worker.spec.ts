import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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

// Access modes
const F_OK = 0; // File exists
const R_OK = 4; // Read permission
const W_OK = 2; // Write permission
const X_OK = 1; // Execute permission

// Helper class to communicate with worker
class WasmFSWorker {
  private worker: Worker;
  private messageId = 0;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e) => {
      const { id, type, success, result, error } = e.data;

      if (type === 'init') {
        const callbacks = this.pending.get(-1);
        if (callbacks) {
          if (success) {
            callbacks.resolve(undefined);
          } else {
            callbacks.reject(new Error(error));
          }
          this.pending.delete(-1);
        }
        return;
      }

      const callbacks = this.pending.get(id);
      if (callbacks) {
        if (success) {
          callbacks.resolve(result);
        } else {
          callbacks.reject(new Error(error));
        }
        this.pending.delete(id);
      }
    };
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.set(-1, { resolve, reject });
      this.worker.postMessage({ command: 'init' });
    });
  }

  private async call(command: string, args: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ command, args, id });
    });
  }

  async testBuiltin(): Promise<number> {
    return this.call('test_builtin');
  }

  async open(path: string, flags: number, mode: number): Promise<number> {
    return this.call('open', { path, flags, mode });
  }

  async close(fd: number): Promise<number> {
    return this.call('close', { fd });
  }

  async write(fd: number, content: string): Promise<number> {
    return this.call('write', { fd, content });
  }

  async read(fd: number, size: number): Promise<{ bytesRead: number; content: string }> {
    return this.call('read', { fd, size });
  }

  async lseek(fd: number, offset: number, whence: number): Promise<number> {
    return this.call('lseek', { fd, offset, whence });
  }

  async fsync(fd: number): Promise<number> {
    return this.call('fsync', { fd });
  }

  async mkdir(path: string, mode: number): Promise<number> {
    return this.call('mkdir', { path, mode });
  }

  async rmdir(path: string): Promise<number> {
    return this.call('rmdir', { path });
  }

  async unlink(path: string): Promise<number> {
    return this.call('unlink', { path });
  }

  async rename(oldPath: string, newPath: string): Promise<number> {
    return this.call('rename', { oldPath, newPath });
  }

  async access(path: string, mode: number): Promise<number> {
    return this.call('access', { path, mode });
  }

  async truncate(path: string, length: number): Promise<number> {
    return this.call('truncate', { path, length });
  }

  async ftruncate(fd: number, length: number): Promise<number> {
    return this.call('ftruncate', { fd, length });
  }

  async chmod(path: string, mode: number): Promise<number> {
    return this.call('chmod', { path, mode });
  }

  async readdir(path: string): Promise<string[]> {
    return this.call('readdir', { path });
  }

  async getErrno(): Promise<number> {
    return this.call('get_errno');
  }

  terminate() {
    this.worker.terminate();
  }
}

describe('WASMFS Worker Module', () => {
  let wasmfs: WasmFSWorker;

  beforeAll(async () => {
    // Check browser capabilities
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer is not available. Check COOP/COEP headers.');
    }

    // Create worker
    const worker = new Worker(new URL('./wasmfs-worker.ts', import.meta.url), {
      type: 'module',
    });

    wasmfs = new WasmFSWorker(worker);

    // Initialize
    await wasmfs.init();
  }, 60000);

  afterAll(() => {
    wasmfs.terminate();
  });

  describe('Initialization', () => {
    it('should run built-in test successfully', async () => {
      const result = await wasmfs.testBuiltin();
      expect(result).toBe(0);
    });

    it('should have OPFS mounted at /opfs', async () => {
      const result = await wasmfs.access('/opfs', F_OK);
      expect(result).toBe(0);
    });
  });

  describe('File Operations', () => {
    const testFile = '/opfs/test-file.txt';
    const testContent = 'Hello, WASMFS from Worker!';

    it('should create and open a new file', async () => {
      const fd = await wasmfs.open(testFile, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      expect(fd).toBeGreaterThan(0);
      await wasmfs.close(fd);
    });

    it('should write data to a file', async () => {
      const fd = await wasmfs.open(testFile, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      const bytesWritten = await wasmfs.write(fd, testContent);
      expect(bytesWritten).toBe(testContent.length);
      await wasmfs.close(fd);
    });

    it('should read data from a file', async () => {
      // Write
      let fd = await wasmfs.open(testFile, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      await wasmfs.write(fd, testContent);
      await wasmfs.close(fd);

      // Read
      fd = await wasmfs.open(testFile, O_RDONLY, 0);
      const { bytesRead, content } = await wasmfs.read(fd, 100);
      expect(bytesRead).toBe(testContent.length);
      expect(content).toBe(testContent);
      await wasmfs.close(fd);
    });

    it('should seek within a file', async () => {
      const fd = await wasmfs.open(testFile, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      await wasmfs.write(fd, testContent);

      // Seek to beginning
      let offset = await wasmfs.lseek(fd, 0, SEEK_SET);
      expect(offset).toBe(0);

      // Seek to end
      offset = await wasmfs.lseek(fd, 0, SEEK_END);
      expect(offset).toBe(testContent.length);

      // Seek to middle
      offset = await wasmfs.lseek(fd, 5, SEEK_SET);
      expect(offset).toBe(5);

      await wasmfs.close(fd);
    });

    it('should sync file data to disk', async () => {
      const fd = await wasmfs.open(testFile, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      await wasmfs.write(fd, testContent);
      const result = await wasmfs.fsync(fd);
      expect(result).toBe(0);
      await wasmfs.close(fd);
    });

    it('should truncate a file', async () => {
      const fd = await wasmfs.open(testFile, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      await wasmfs.write(fd, testContent);

      // Truncate to 5 bytes
      const truncResult = await wasmfs.ftruncate(fd, 5);
      expect(truncResult).toBe(0);

      // Verify size
      const offset = await wasmfs.lseek(fd, 0, SEEK_END);
      expect(offset).toBe(5);

      await wasmfs.close(fd);
    });

    it('should append to a file', async () => {
      const appendFile = '/opfs/append-test.txt';

      // Clean up first
      await wasmfs.unlink(appendFile).catch(() => {});

      let fd = await wasmfs.open(appendFile, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      await wasmfs.write(fd, 'First ');
      await wasmfs.close(fd);

      // Open in append mode
      fd = await wasmfs.open(appendFile, O_WRONLY | O_APPEND, 0);
      await wasmfs.write(fd, 'Second');
      await wasmfs.close(fd);

      // Read back
      fd = await wasmfs.open(appendFile, O_RDONLY, 0);
      const { content } = await wasmfs.read(fd, 100);
      expect(content).toBe('First Second');
      await wasmfs.close(fd);

      // Clean up
      await wasmfs.unlink(appendFile);
    });

    it('should delete a file', async () => {
      const deleteFile = '/opfs/delete-test.txt';

      // Create a fresh file
      const fd = await wasmfs.open(deleteFile, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      await wasmfs.write(fd, 'test content');
      await wasmfs.close(fd);

      // Verify it exists
      const existsResult = await wasmfs.access(deleteFile, F_OK);
      expect(existsResult).toBe(0);

      // Delete it
      const unlinkResult = await wasmfs.unlink(deleteFile);
      expect(unlinkResult).toBe(0);

      // Verify file is gone
      const accessResult = await wasmfs.access(deleteFile, F_OK);
      expect(accessResult).toBe(-1);
    });
  });

  describe('Directory Operations', () => {
    const testDir = '/opfs/test-directory';
    const nestedDir = '/opfs/test-directory/nested';

    it('should create a directory', async () => {
      const result = await wasmfs.mkdir(testDir, 0o777);
      expect(result).toBe(0);
    });

    it('should create nested directories', async () => {
      const result = await wasmfs.mkdir(nestedDir, 0o777);
      expect(result).toBe(0);
    });

    it('should check directory accessibility', async () => {
      const result = await wasmfs.access(testDir, F_OK);
      expect(result).toBe(0);
    });

    it('should remove an empty directory', async () => {
      const result = await wasmfs.rmdir(nestedDir);
      expect(result).toBe(0);
    });

    it('should clean up test directory', async () => {
      await wasmfs.rmdir(testDir);
    });

    it('should list directory contents with readdir', async () => {
      const testReadDir = '/opfs/readdir-test';

      // Create directory
      await wasmfs.mkdir(testReadDir, 0o777);

      // Create some files
      const fd1 = await wasmfs.open(`${testReadDir}/file1.txt`, O_RDWR | O_CREAT, 0o666);
      await wasmfs.close(fd1);
      const fd2 = await wasmfs.open(`${testReadDir}/file2.txt`, O_RDWR | O_CREAT, 0o666);
      await wasmfs.close(fd2);

      // Create a subdirectory
      await wasmfs.mkdir(`${testReadDir}/subdir`, 0o777);

      // Read directory contents
      const entries = await wasmfs.readdir(testReadDir);
      console.log('Directory entries:', entries);

      // Should contain our files and subdirectory
      expect(entries).toContain('file1.txt');
      expect(entries).toContain('file2.txt');
      expect(entries).toContain('subdir');
      expect(entries.length).toBe(3);

      // Clean up
      await wasmfs.unlink(`${testReadDir}/file1.txt`);
      await wasmfs.unlink(`${testReadDir}/file2.txt`);
      await wasmfs.rmdir(`${testReadDir}/subdir`);
      await wasmfs.rmdir(testReadDir);
    });

    it('should list /opfs root directory', async () => {
      // Create some test entries directly in /opfs
      await wasmfs.mkdir('/opfs/test-root-dir', 0o777);
      const fd = await wasmfs.open('/opfs/test-root-file.txt', O_RDWR | O_CREAT, 0o666);
      await wasmfs.close(fd);

      // List /opfs root
      const entries = await wasmfs.readdir('/opfs');
      console.log('/opfs root entries:', entries);

      // Should contain our test entries
      expect(entries).toContain('test-root-dir');
      expect(entries).toContain('test-root-file.txt');

      // Clean up
      await wasmfs.rmdir('/opfs/test-root-dir');
      await wasmfs.unlink('/opfs/test-root-file.txt');
    });
  });

  describe('Path Operations', () => {
    const sourceFile = '/opfs/source.txt';
    const targetFile = '/opfs/target.txt';

    it('should rename a file', async () => {
      // Create source file
      const fd = await wasmfs.open(sourceFile, O_RDWR | O_CREAT | O_TRUNC, 0o666);
      await wasmfs.close(fd);

      // Rename
      const result = await wasmfs.rename(sourceFile, targetFile);
      expect(result).toBe(0);

      // Verify source is gone
      const accessResult = await wasmfs.access(sourceFile, F_OK);
      expect(accessResult).toBe(-1);

      // Verify target exists
      const targetAccessResult = await wasmfs.access(targetFile, F_OK);
      expect(targetAccessResult).toBe(0);
    });

    it('should change file permissions', async () => {
      const result = await wasmfs.chmod(targetFile, 0o644);
      expect(result).toBe(0);
    });

    it('should clean up test files', async () => {
      await wasmfs.unlink(targetFile);
    });
  });

  describe('Error Handling', () => {
    it('should return error for non-existent file', async () => {
      const fd = await wasmfs.open('/opfs/does-not-exist.txt', O_RDONLY, 0);
      expect(fd).toBe(-1);

      const errno = await wasmfs.getErrno();
      expect(errno).toBeGreaterThan(0);
    });

    it('should return error for invalid file descriptor', async () => {
      const result = await wasmfs.close(99999);
      expect(result).toBe(-1);
    });

    it('should return error when creating file with O_EXCL on existing file', async () => {
      // Create file first
      const fd1 = await wasmfs.open('/opfs/excl-test.txt', O_RDWR | O_CREAT, 0o666);
      await wasmfs.close(fd1);

      // Try to create again with O_EXCL
      const fd2 = await wasmfs.open('/opfs/excl-test.txt', O_RDWR | O_CREAT | O_EXCL, 0o666);
      expect(fd2).toBe(-1);

      // Clean up
      await wasmfs.unlink('/opfs/excl-test.txt');
    });
  });

  describe('Large Files', () => {
    it('should handle writing and reading large files', async () => {
      const fd = await wasmfs.open('/opfs/large.txt', O_RDWR | O_CREAT | O_TRUNC, 0o666);

      // Write multiple chunks
      const chunk = 'X'.repeat(1000);
      for (let i = 0; i < 100; i++) {
        const bytesWritten = await wasmfs.write(fd, chunk);
        expect(bytesWritten).toBe(chunk.length);
      }

      await wasmfs.fsync(fd);

      // Seek back and read
      await wasmfs.lseek(fd, 0, SEEK_SET);
      const { bytesRead } = await wasmfs.read(fd, 10000);
      expect(bytesRead).toBeGreaterThan(0);

      await wasmfs.close(fd);
      await wasmfs.unlink('/opfs/large.txt');
    });
  });
});
