import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	InMemoryFileSystem,
	InternalFileHandle,
	promiseFromSync,
} from './filesystem.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const decode = (input: Uint8Array | string) =>
	typeof input === 'string' ? input : decoder.decode(input);
const toArray = (bytes: Uint8Array) => Array.from(bytes);

const base64ToString = (value: string) => {
	const BASE64_CHARS =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	const charToValue = new Map<string, number>();
	for (let i = 0; i < BASE64_CHARS.length; i += 1) {
		charToValue.set(BASE64_CHARS[i], i);
	}
	const cleaned = value.replace(/[\r\n\s]/g, '');
	let padding = 0;
	if (cleaned.endsWith('==')) {
		padding = 2;
	} else if (cleaned.endsWith('=')) {
		padding = 1;
	}
	const outputLength = (cleaned.length / 4) * 3 - padding;
	const bytes = new Uint8Array(outputLength);
	let outIndex = 0;
	for (let i = 0; i < cleaned.length; i += 4) {
		const c1 = charToValue.get(cleaned[i]) ?? 0;
		const c2 = charToValue.get(cleaned[i + 1]) ?? 0;
		const c3 =
			cleaned[i + 2] === '=' ? 0 : charToValue.get(cleaned[i + 2]) ?? 0;
		const c4 =
			cleaned[i + 3] === '=' ? 0 : charToValue.get(cleaned[i + 3]) ?? 0;
		const triple = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
		if (outIndex < bytes.length) {
			bytes[outIndex++] = (triple >> 16) & 0xff;
		}
		if (outIndex < bytes.length) {
			bytes[outIndex++] = (triple >> 8) & 0xff;
		}
		if (outIndex < bytes.length) {
			bytes[outIndex++] = triple & 0xff;
		}
	}
	let output = '';
	for (let i = 0; i < bytes.length; i += 1) {
		output += String.fromCharCode(bytes[i]);
	}
	return output;
};

describe('InMemoryFileSystem', () => {
	let fs: InMemoryFileSystem;

	beforeEach(() => {
		fs = new InMemoryFileSystem();
	});

	it('writes and reads files with buffers and encodings', () => {
		fs.writeFileSync('/file.txt', 'hello');
		const raw = fs.readFileSync('/file.txt');
		expect(raw).toBeInstanceOf(Uint8Array);
		expect(decode(raw)).toBe('hello');

		const asUtf8 = fs.readFileSync('/file.txt', 'utf8');
		expect(asUtf8).toBe('hello');

		const payload = new Uint8Array([0, 1, 2, 3]);
		fs.writeFileSync('/payload.bin', payload);
		const bytes = fs.readFileSync('/payload.bin');
		expect(bytes).not.toBe(payload);
		expect(toArray(bytes)).toEqual(toArray(payload));
	});

	it('handles utf8, ascii, binary, and base64 encodings during read and write', () => {
		const utf8Value = 'café ☕';
		fs.writeFileSync('/utf8.txt', utf8Value, 'utf8');
		expect(fs.readFileSync('/utf8.txt', 'utf8')).toBe(utf8Value);

		const asciiValue = 'ASCII TEXT';
		fs.writeFileSync('/ascii.txt', asciiValue, 'ascii');
		expect(fs.readFileSync('/ascii.txt', 'ascii')).toBe(asciiValue);
		expect(toArray(fs.readFileSync('/ascii.txt'))).toEqual(
			[...asciiValue].map((char) => char.charCodeAt(0) & 0x7f)
		);

		const binarySource = '\u0000\u0001\u007f\u0080\u00ffA';
		fs.writeFileSync('/binary.bin', binarySource, { encoding: 'binary' });
		const binaryBytes = fs.readFileSync('/binary.bin');
		expect(toArray(binaryBytes)).toEqual([0, 1, 127, 128, 255, 65]);
		const binaryString = fs.readFileSync('/binary.bin', 'binary');
		expect(binaryString.length).toBe(binarySource.length);
		for (let index = 0; index < binarySource.length; index += 1) {
			expect(binaryString.charCodeAt(index)).toBe(
				binarySource.charCodeAt(index) & 0xff
			);
		}

		fs.writeFileSync('/base64.bin', 'aGVsbG8=', 'base64');
		expect(decode(fs.readFileSync('/base64.bin'))).toBe('hello');
		expect(fs.readFileSync('/base64.bin', 'base64')).toBe('aGVsbG8=');

		fs.writeFileSync('/latin1.bin', '\u00ffOK', 'latin1');
		const latin1 = fs.readFileSync('/latin1.bin', 'latin1');
		expect(latin1).toBe('\u00ffOK');

		fs.writeFileSync('/buffer.bin', 'buffer!', 'utf8');
		const bufferResult = fs.readFileSync('/buffer.bin', 'buffer');
		expect(bufferResult instanceof Uint8Array).toBe(true);
		expect(new TextDecoder().decode(bufferResult)).toBe('buffer!');
	});

	it('throws an ENOENT error when reading a missing file', () => {
		let caught: any;
		try {
			fs.readFileSync('/missing.txt');
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeDefined();
		expect(caught.code).toBe('ENOENT');
		expect(caught.message).toContain('ENOENT: no such file or directory');
	});

	it('appends to existing files and creates missing ones', () => {
		fs.writeFileSync('/log.txt', 'line one');
		fs.appendFileSync('/log.txt', '\nline two');
		expect(fs.readFileSync('/log.txt', 'utf8')).toBe('line one\nline two');

		fs.appendFileSync('/created.txt', 'born');
		expect(fs.readFileSync('/created.txt', 'utf8')).toBe('born');
	});

	it('creates nested directories and reports errors like Node.js', () => {
		const firstCreated = fs.mkdirSync('/foo/bar', { recursive: true });
		expect(firstCreated).toBe('/foo');
		expect(fs.existsSync('/foo')).toBe(true);
		expect(fs.existsSync('/foo/bar')).toBe(true);

		expect(() => fs.mkdirSync('/foo/bar')).toThrowError(/EEXIST/);

		let missingParentError: any;
		try {
			fs.mkdirSync('/alpha/beta');
		} catch (error) {
			missingParentError = error;
		}
		expect(missingParentError).toBeDefined();
		expect(missingParentError.code).toBe('ENOENT');
	});

	it('reads from processController stdin when fd is 0', () => {
		const readSequence: Array<string | null> = ['abcdefg', 'h', null];
		const stdin = {
			read: vi.fn(() => readSequence.shift()),
		};
		const original = (globalThis as any).processController;
		(globalThis as any).processController = { stdin } as unknown;

		try {
			const first = fs.readSync(0, 3, null);
			expect(first).toBeInstanceOf(Uint8Array);
			expect(Array.from(first ?? [])).toEqual([97, 98, 99]); // 'abc'

			const second = fs.readSync(0, 5, null);
			expect(second).toBeInstanceOf(Uint8Array);
			expect(Array.from(second ?? [])).toEqual([100, 101, 102, 103, 104]); // 'defgh'

			const third = fs.readSync(0, 2, null);
			expect(third).toBeInstanceOf(Uint8Array);
			expect((third as Uint8Array).byteLength).toBe(0);
		} finally {
			(globalThis as any).processController = original;
		}

		expect(stdin.read).toHaveBeenCalledTimes(3);
	});

	it('lists directory entries with optional encodings and dirents', () => {
		fs.mkdirSync('/dir');
		fs.writeFileSync('/dir/file.txt', 'data');
		fs.mkdirSync('/dir/sub');

		const entries = fs.readdirSync('/dir');
		expect(entries.sort()).toEqual(['file.txt', 'sub']);

		const dirents = fs.readdirSync('/dir', { withFileTypes: true });
		const direntNames = dirents.map((entry) => entry.name).sort();
		expect(direntNames).toEqual(['file.txt', 'sub']);
		const subDirent = dirents.find((entry) => entry.name === 'sub');
		expect(subDirent?.isDirectory()).toBe(true);

		const buffers = fs.readdirSync('/dir', 'buffer');
		expect(buffers.every((entry) => entry instanceof Uint8Array)).toBe(
			true
		);

		const base64 = fs.readdirSync('/dir', 'base64');
		const decoded = base64.map((name) => base64ToString(name));
		expect(decoded).toEqual(entries);
	});

	it('supports the scandir binding variant and encoding validation', () => {
		fs.mkdirSync('/bind');
		fs.writeFileSync('/bind/file.txt', '');
		fs.mkdirSync('/bind/inner');

		const names = fs.readdirBindingSync('/bind');
		expect(names).toEqual(['file.txt', 'inner']);

		const [encodedNames, types] = fs.readdirBindingSync(
			'/bind',
			null,
			true
		);
		expect(encodedNames).toEqual(['file.txt', 'inner']);
		expect(types).toEqual([1, 2]);

		const bufferNames = fs.readdirBindingSync('/bind', 'buffer');
		expect(bufferNames.every((entry) => entry instanceof Uint8Array)).toBe(
			true
		);

		expect(() => fs.readdirBindingSync('/bind', 'utf16le')).toThrowError(
			/Unsupported encoding/
		);
	});

	it('handles symlinks with stat and lstat semantics', () => {
		fs.writeFileSync('/target.txt', 'payload');
		fs.symlinkSync('/target.txt', '/link.txt');

		const stat = fs.statSync('/link.txt');
		expect(stat.isFile()).toBe(true);
		expect(stat.size).toBe(7);

		const lstat = fs.lstatSync('/link.txt');
		expect(lstat.isSymbolicLink()).toBe(true);

		expect(fs.readlinkSync('/link.txt')).toBe('/target.txt');
	});

	it('supports unlinking files and protects directories', () => {
		fs.writeFileSync('/remove-me.txt', 'bye');
		fs.unlinkSync('/remove-me.txt');
		expect(fs.existsSync('/remove-me.txt')).toBe(false);

		fs.mkdirSync('/cannot-unlink');
		expect(() => fs.unlinkSync('/cannot-unlink')).toThrowError(/EPERM/);
	});

	it('removes directories recursively when requested', () => {
		fs.mkdirSync('/tree/branch', { recursive: true });
		fs.writeFileSync('/tree/branch/leaf.txt', 'leaf');

		expect(() => fs.rmdirSync('/tree')).toThrowError(/ENOTEMPTY/);

		fs.rmdirSync('/tree', { recursive: true });
		expect(fs.existsSync('/tree')).toBe(false);
	});

	it('opens, writes, reads, and closes file descriptors', () => {
		const fd = fs.openSync('/life-cycle.txt', 'w+');
		expect(fs.writeSync(fd, 'hello')).toBe(5);

		const readAll = fs.readSync(fd, 5, 0);
		expect(decode(readAll)).toBe('hello');

		const extra = fs.readSync(fd, 5);
		expect(extra.length).toBe(0);

		fs.closeSync(fd);

		expect(() => fs.closeSync(fd)).toThrowError(/EBADF/);
	});

	it('applies open flags like truncate, append, and exclusive create', () => {
		fs.writeFileSync('/flags.txt', 'existing');

		const truncateFd = fs.openSync('/flags.txt', 'w');
		fs.closeSync(truncateFd);
		expect(fs.readFileSync('/flags.txt').length).toBe(0);

		const appendFd = fs.openSync('/flags.txt', 'a');
		fs.writeSync(appendFd, 'abc');
		fs.closeSync(appendFd);
		expect(fs.readFileSync('/flags.txt', 'utf8')).toBe('abc');

		expect(() => fs.openSync('/flags.txt', 'wx')).toThrowError(/EEXIST/);

		let readMissingError: any;
		try {
			fs.openSync('/nope.txt', 'r');
		} catch (error) {
			readMissingError = error;
		}
		expect(readMissingError?.code).toBe('ENOENT');
	});

	it('supports positional reads without moving the internal offset', () => {
		fs.writeFileSync('/positions.txt', 'abcdef');
		const fd = fs.openSync('/positions.txt', 'r');

		const slice = fs.readSync(fd, 3, 1);
		expect(decode(slice)).toBe('bcd');

		const again = fs.readSync(fd, 2);
		expect(decode(again)).toBe('ab');

		fs.closeSync(fd);
	});

	it('truncates files by path and by descriptor', () => {
		fs.writeFileSync('/truncate.txt', 'abcdef');
		fs.truncateSync('/truncate.txt', 2);
		expect(fs.readFileSync('/truncate.txt', 'utf8')).toBe('ab');

		const fd = fs.openSync('/truncate.txt', 'r+');
		fs.ftruncateSync(fd, 1);
		fs.closeSync(fd);
		expect(fs.readFileSync('/truncate.txt', 'utf8')).toBe('a');
	});

	it('updates timestamps via utimes and futimes', () => {
		fs.writeFileSync('/times.txt', 'tick');
		const atime = new Date('2020-01-01T00:00:00Z');
		const mtime = new Date('2021-01-01T00:00:00Z');

		fs.utimesSync('/times.txt', atime, mtime);
		let stats = fs.statSync('/times.txt');
		expect(stats.atimeMs).toBe(atime.getTime());
		expect(stats.mtimeMs).toBe(mtime.getTime());

		const fd = fs.openSync('/times.txt', 'r+');
		fs.futimesSync(fd, 10, 20);
		fs.closeSync(fd);

		stats = fs.statSync('/times.txt');
		expect(stats.atimeMs).toBe(10000);
		expect(stats.mtimeMs).toBe(20000);
	});

	it('creates hard links that share underlying data', () => {
		fs.writeFileSync('/original.txt', 'data');
		fs.linkSync('/original.txt', '/alias.txt');
		fs.writeFileSync('/alias.txt', 'mutated');

		expect(fs.readFileSync('/original.txt', 'utf8')).toBe('mutated');
		expect(fs.readFileSync('/alias.txt', 'utf8')).toBe('mutated');
	});

	it('copies files and enforces COPYFILE_EXCL semantics', () => {
		fs.writeFileSync('/source.txt', 'payload');
		fs.copyFileSync('/source.txt', '/copy.txt');
		expect(fs.readFileSync('/copy.txt', 'utf8')).toBe('payload');

		expect(() =>
			fs.copyFileSync('/source.txt', '/copy.txt', 1)
		).toThrowError(/EEXIST/);
	});

	it('recursively copies directories with cpSync options', () => {
		fs.mkdirSync('/src/inner', { recursive: true });
		fs.writeFileSync('/src/root.txt', 'root');
		fs.writeFileSync('/src/inner/child.txt', 'child');
		fs.writeFileSync('/src/skip.me', 'skip');

		expect(() =>
			fs.cpSync('/src', '/dst', { recursive: false })
		).toThrowError(/EISDIR/);

		fs.cpSync('/src', '/dst', {
			recursive: true,
			filter: (srcPath) => !srcPath.endsWith('skip.me'),
		});

		expect(fs.readFileSync('/dst/root.txt', 'utf8')).toBe('root');
		expect(fs.readFileSync('/dst/inner/child.txt', 'utf8')).toBe('child');
		expect(fs.existsSync('/dst/skip.me')).toBe(false);
	});

	it('renames files atomically', () => {
		fs.writeFileSync('/old-name.txt', 'value');
		fs.renameSync('/old-name.txt', '/new-name.txt');

		expect(fs.existsSync('/old-name.txt')).toBe(false);
		expect(fs.readFileSync('/new-name.txt', 'utf8')).toBe('value');
	});

	it('creates unique temporary directories', () => {
		const first = fs.mkdtempSync('/tmp-');
		const second = fs.mkdtempSync('/tmp-');
		expect(first).not.toBe(second);
		expect(fs.existsSync(first)).toBe(true);
		expect(fs.existsSync(second)).toBe(true);
	});

	it('supports vectored writes and reads', () => {
		const fd = fs.openSync('/vector.txt', 'w+');
		const buffers = [encoder.encode('Hello'), encoder.encode(' World')];
		const written = fs.writeBuffersSync(fd, buffers, 0);
		expect(written).toBe(11);

		const readBuffers = [new Uint8Array(5), new Uint8Array(6)];
		const bytesRead = fs.readBuffersSync(fd, readBuffers, 0);
		expect(bytesRead).toBe(11);
		expect(decode(readBuffers[0]) + decode(readBuffers[1])).toBe(
			'Hello World'
		);

		fs.closeSync(fd);
	});

	it('exports stats as numeric arrays', () => {
		fs.writeFileSync('/stats.txt', 'abc');
		const stats = fs.statSync('/stats.txt');

		const floats = fs.statsToArray(stats);
		expect(floats).toBeInstanceOf(Float64Array);
		expect(Number(floats[8])).toBe(3);

		const bigints = fs.statsToArray(stats, true);
		expect(bigints).toBeInstanceOf(BigInt64Array);
		expect(bigints[8]).toBe(BigInt(3));
	});

	it('provides InternalFileHandle wrappers', async () => {
		const fd = fs.openSync('/handle.txt', 'w+');
		fs.writeSync(fd, 'handle');

		const handle = new InternalFileHandle(fd, fs);
		const read = handle.read(0, 6, 0);
		expect(decode(read)).toBe('handle');

		const stats = handle.stat();
		expect(stats.isFile()).toBe(true);

		handle.truncate(3);
		expect(fs.readFileSync('/handle.txt', 'utf8')).toBe('han');

		const stringWrite = await handle.write('dle');
		expect(stringWrite.bytesWritten).toBe(3);
		expect(stringWrite.buffer).toBe('dle');
		expect(fs.readFileSync('/handle.txt', 'utf8')).toBe('handle');

		const bufferPayload = encoder.encode('XYZ');
		const bufferWrite = await handle.write(
			bufferPayload,
			0,
			bufferPayload.length,
			0
		);
		expect(bufferWrite.bytesWritten).toBe(3);
		expect(bufferWrite.buffer).toBe(bufferPayload);
		expect(fs.readFileSync('/handle.txt', 'utf8')).toBe('XYZdle');

		await handle.close();
		expect(() => handle.read(0, 1, 0)).toThrowError(/EBADF/);
		await expect(handle.write('nope')).rejects.toThrowError(/EBADF/);
	});

	it('supports low-level write operations', async () => {
		const fd = fs.openSync('/write-sync.txt', 'w+');
		expect(fs.writeSync(fd, 'hello')).toBe(5);
		expect(fs.readFileSync('/write-sync.txt', 'utf8')).toBe('hello');

		// Absolute position write should not move the internal offset
		expect(fs.writeSync(fd, 'START', 0, 'utf8')).toBe(5);
		expect(fs.writeSync(fd, 'end')).toBe(3);
		expect(fs.readFileSync('/write-sync.txt', 'utf8')).toBe('STARTend');

		// Buffer write with explicit position
		const overwrite = encoder.encode('!!');
		expect(fs.writeSync(fd, overwrite, 0, overwrite.length, 2)).toBe(2);
		expect(fs.readFileSync('/write-sync.txt', 'utf8')).toBe('ST!!Tend');
		fs.closeSync(fd);

		// writeFileSync accepts both string and buffer input
		fs.writeFileSync('/write-file.txt', 'initial', { encoding: 'utf8' });
		expect(fs.readFileSync('/write-file.txt', 'utf8')).toBe('initial');
		fs.writeFileSync('/write-file.txt', encoder.encode('buf'));
		expect(fs.readFileSync('/write-file.txt', 'utf8')).toBe('buf');

		// writeBufferSync writes slices
		const writeBufferFd = fs.openSync('/write-buffer.bin', 'w+');
		const source = encoder.encode('abcdef');
		expect(fs.writeBufferSync(writeBufferFd, source, 1, 3, 0)).toBe(3);
		expect(Array.from(fs.readFileSync('/write-buffer.bin'))).toEqual(
			Array.from(encoder.encode('bcd'))
		);

		// writeBuffer with FSReq-style callback
		const extra = encoder.encode('ZZ');
		const asyncBytes = await new Promise((resolve, reject) => {
			fs.writeBuffer(writeBufferFd, extra, 0, extra.length, 3, {
				oncomplete(err, bytesWritten) {
					if (err) reject(err);
					else resolve(bytesWritten);
				},
			});
		});
		expect(asyncBytes).toBe(2);
		expect(Array.from(fs.readFileSync('/write-buffer.bin'))).toEqual(
			Array.from(encoder.encode('bcdZZ'))
		);
		fs.closeSync(writeBufferFd);

		// writeBuffersSync can target an explicit position
		const vectorFd = fs.openSync('/write-buffers.txt', 'w+');
		expect(
			fs.writeBuffersSync(
				vectorFd,
				[encoder.encode('hi'), encoder.encode('!')],
				0
			)
		).toBe(3);
		expect(fs.readFileSync('/write-buffers.txt', 'utf8')).toBe('hi!');
		fs.closeSync(vectorFd);

		// writeFileUtf8 respects append and exclusive flags
		const O_APPEND = 8;
		const O_EXCL = 2048;
		fs.writeFileUtf8('/write-utf8.txt', 'base', 0);
		fs.writeFileUtf8('/write-utf8.txt', '++', O_APPEND);
		expect(fs.readFileSync('/write-utf8.txt', 'utf8')).toBe('base++');
		const errorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		expect(() =>
			fs.writeFileUtf8('/write-utf8.txt', 'nope', O_EXCL)
		).toThrow(/EEXIST/);
		errorSpy.mockRestore();

		// writeFileAsync uses FSReqCallback semantics
		await new Promise((resolve, reject) => {
			fs.writeFileAsync('/write-async.txt', 'async', null, {
				oncomplete(err) {
					if (err) reject(err);
					else resolve(null);
				},
			});
		});
		expect(fs.readFileSync('/write-async.txt', 'utf8')).toBe('async');

		// writeAsync mirrors fs.write with callback
		const asyncFd = fs.openSync('/write-async-fd.txt', 'w+');
		const payload = encoder.encode('payload');
		const bytesWritten = await new Promise((resolve, reject) => {
			fs.writeAsync(asyncFd, payload, 0, payload.length, null, {
				oncomplete(err, written) {
					if (err) reject(err);
					else resolve(written);
				},
			});
		});
		expect(bytesWritten).toBe(payload.length);
		expect(fs.readFileSync('/write-async-fd.txt', 'utf8')).toBe('payload');
		fs.closeSync(asyncFd);
	});
});

describe('promiseFromSync', () => {
	it('wraps successful calls', async () => {
		const value = await promiseFromSync(() => 42);
		expect(value).toBe(42);
	});

	it('propagates errors from the sync function', async () => {
		await expect(
			promiseFromSync(() => {
				throw new Error('boom');
			})
		).rejects.toThrowError('boom');
	});
});
