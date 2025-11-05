#include <assert.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#include <emscripten.h>
#include <emscripten/console.h>
#include <emscripten/wasmfs.h>

static backend_t opfs_backend;

// Initialize the OPFS filesystem backend
EMSCRIPTEN_KEEPALIVE
int fs_init(void) {
  emscripten_console_log("Initializing WASMFS with OPFS backend");

  // Create OPFS backend
  opfs_backend = wasmfs_create_opfs_backend();
  if (opfs_backend == 0) {
    emscripten_console_error("Failed to create OPFS backend");
    return -1;
  }
  emscripten_console_log("Created OPFS backend");

  // Mount OPFS at /opfs for all filesystem operations
  int err = wasmfs_create_directory("/opfs", 0777, opfs_backend);
  if (err != 0) {
    emscripten_console_error("Failed to mount OPFS directory");
    return -1;
  }
  emscripten_console_log("Mounted OPFS at /opfs");

  return 0;
}

// File operations exported to JS

EMSCRIPTEN_KEEPALIVE
int fs_open(const char* path, int flags, int mode) {
  int fd = open(path, flags, mode);
  if (fd < 0) {
    emscripten_console_logf("fs_open failed: %s (errno=%d)", path, errno);
  }
  return fd;
}

EMSCRIPTEN_KEEPALIVE
int fs_close(int fd) {
  return close(fd);
}

EMSCRIPTEN_KEEPALIVE
int fs_read(int fd, char* buf, size_t count) {
  return read(fd, buf, count);
}

EMSCRIPTEN_KEEPALIVE
int fs_write(int fd, const char* buf, size_t count) {
  return write(fd, buf, count);
}

EMSCRIPTEN_KEEPALIVE
off_t fs_lseek(int fd, off_t offset, int whence) {
  return lseek(fd, offset, whence);
}

EMSCRIPTEN_KEEPALIVE
int fs_fsync(int fd) {
  return fsync(fd);
}

EMSCRIPTEN_KEEPALIVE
int fs_fdatasync(int fd) {
  return fdatasync(fd);
}

EMSCRIPTEN_KEEPALIVE
int fs_fstat(int fd, struct stat* st) {
  return fstat(fd, st);
}

EMSCRIPTEN_KEEPALIVE
int fs_stat(const char* path, struct stat* st) {
  return stat(path, st);
}

EMSCRIPTEN_KEEPALIVE
int fs_lstat(const char* path, struct stat* st) {
  return lstat(path, st);
}

// Directory operations

EMSCRIPTEN_KEEPALIVE
int fs_mkdir(const char* path, mode_t mode) {
  return mkdir(path, mode);
}

EMSCRIPTEN_KEEPALIVE
int fs_rmdir(const char* path) {
  return rmdir(path);
}

EMSCRIPTEN_KEEPALIVE
int fs_unlink(const char* path) {
  return unlink(path);
}

EMSCRIPTEN_KEEPALIVE
int fs_rename(const char* oldpath, const char* newpath) {
  return rename(oldpath, newpath);
}

EMSCRIPTEN_KEEPALIVE
int fs_chmod(const char* path, mode_t mode) {
  return chmod(path, mode);
}

EMSCRIPTEN_KEEPALIVE
int fs_fchmod(int fd, mode_t mode) {
  return fchmod(fd, mode);
}

EMSCRIPTEN_KEEPALIVE
int fs_truncate(const char* path, off_t length) {
  return truncate(path, length);
}

EMSCRIPTEN_KEEPALIVE
int fs_ftruncate(int fd, off_t length) {
  return ftruncate(fd, length);
}

EMSCRIPTEN_KEEPALIVE
int fs_access(const char* path, int mode) {
  return access(path, mode);
}

EMSCRIPTEN_KEEPALIVE
char* fs_getcwd(char* buf, size_t size) {
  return getcwd(buf, size);
}

EMSCRIPTEN_KEEPALIVE
int fs_chdir(const char* path) {
  return chdir(path);
}

EMSCRIPTEN_KEEPALIVE
int fs_symlink(const char* target, const char* linkpath) {
  return symlink(target, linkpath);
}

EMSCRIPTEN_KEEPALIVE
ssize_t fs_readlink(const char* path, char* buf, size_t bufsiz) {
  return readlink(path, buf, bufsiz);
}

// Directory reading
EMSCRIPTEN_KEEPALIVE
void* fs_opendir(const char* path) {
  return opendir(path);
}

EMSCRIPTEN_KEEPALIVE
struct dirent* fs_readdir(void* dirp) {
  return readdir((DIR*)dirp);
}

EMSCRIPTEN_KEEPALIVE
int fs_closedir(void* dirp) {
  return closedir((DIR*)dirp);
}

// Get errno (useful for error handling in JS)
EMSCRIPTEN_KEEPALIVE
int fs_get_errno(void) {
  return errno;
}

// Main function for PROXY_TO_PTHREAD
int main(int argc, char** argv) {
  emscripten_console_log("WASMFS module loaded, ready to initialize");
  // Don't auto-initialize, let JS call fs_init() when ready
  return 0;
}

// Simple test function
EMSCRIPTEN_KEEPALIVE
int fs_test(void) {
  emscripten_console_log("Running WASMFS test");

  // Create a test directory
  int err = mkdir("/opfs/test", 0777);
  if (err != 0) {
    emscripten_console_logf("Failed to create test directory (errno=%d)", errno);
    return -1;
  }
  emscripten_console_log("Created test directory");

  // Create a test file
  int fd = open("/opfs/test/hello.txt", O_RDWR | O_CREAT | O_TRUNC, 0777);
  if (fd < 0) {
    emscripten_console_logf("Failed to create test file (errno=%d)", errno);
    return -1;
  }
  emscripten_console_log("Created test file");

  // Write to the file
  const char* msg = "Hello from WASMFS with OPFS!";
  ssize_t nwritten = write(fd, msg, strlen(msg));
  if (nwritten < 0) {
    emscripten_console_logf("Failed to write to file (errno=%d)", errno);
    close(fd);
    return -1;
  }
  emscripten_console_logf("Wrote %d bytes", (int)nwritten);

  // Sync to disk
  fdatasync(fd);

  // Seek to beginning
  lseek(fd, 0, SEEK_SET);

  // Read back
  char buf[100] = {0};
  ssize_t nread = read(fd, buf, sizeof(buf) - 1);
  if (nread < 0) {
    emscripten_console_logf("Failed to read from file (errno=%d)", errno);
    close(fd);
    return -1;
  }
  emscripten_console_logf("Read back: %s (%d bytes)", buf, (int)nread);

  // Verify content
  if (strcmp(buf, msg) != 0) {
    emscripten_console_error("Content mismatch!");
    close(fd);
    return -1;
  }

  close(fd);
  emscripten_console_log("Test passed!");

  return 0;
}
