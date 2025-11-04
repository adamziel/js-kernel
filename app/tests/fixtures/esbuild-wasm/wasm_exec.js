// Copyright 2018 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

'use strict';

(() => {
	const enosys = () => {
		const err = new Error('not implemented');
		err.code = 'ENOSYS';
		return err;
	};

	if (!globalThis.fs) {
		throw new Error('globalThis.fs is not available!!!');
		let outputBuf = '';
		globalThis.fs = {
			constants: {
				O_WRONLY: -1,
				O_RDWR: -1,
				O_CREAT: -1,
				O_TRUNC: -1,
				O_APPEND: -1,
				O_EXCL: -1,
			}, // unused
			writeSync(fd, buf) {
				outputBuf += decoder.decode(buf);
				const nl = outputBuf.lastIndexOf('\n');
				if (nl != -1) {
					(console.error, function () {})(outputBuf.substring(0, nl));
					outputBuf = outputBuf.substring(nl + 1);
				}
				return buf.length;
			},
			write(fd, buf, offset, length, position, callback) {
				if (
					offset !== 0 ||
					length !== buf.length ||
					position !== null
				) {
					callback(enosys());
					return;
				}
				const n = this.writeSync(fd, buf);
				callback(null, n);
			},
			chmod(path, mode, callback) {
				callback(enosys());
			},
			chown(path, uid, gid, callback) {
				callback(enosys());
			},
			close(fd, callback) {
				callback(enosys());
			},
			fchmod(fd, mode, callback) {
				callback(enosys());
			},
			fchown(fd, uid, gid, callback) {
				callback(enosys());
			},
			fstat(fd, callback) {
				callback(enosys());
			},
			fsync(fd, callback) {
				callback(null);
			},
			ftruncate(fd, length, callback) {
				callback(enosys());
			},
			lchown(path, uid, gid, callback) {
				callback(enosys());
			},
			link(path, link, callback) {
				callback(enosys());
			},
			lstat(path, callback) {
				callback(enosys());
			},
			mkdir(path, perm, callback) {
				callback(enosys());
			},
			open(path, flags, mode, callback) {
				callback(enosys());
			},
			read(fd, buffer, offset, length, position, callback) {
				callback(enosys());
			},
			readdir(path, callback) {
				callback(enosys());
			},
			readlink(path, callback) {
				callback(enosys());
			},
			rename(from, to, callback) {
				callback(enosys());
			},
			rmdir(path, callback) {
				callback(enosys());
			},
			stat(path, callback) {
				callback(enosys());
			},
			symlink(path, link, callback) {
				callback(enosys());
			},
			truncate(path, length, callback) {
				callback(enosys());
			},
			unlink(path, callback) {
				callback(enosys());
			},
			utimes(path, atime, mtime, callback) {
				callback(enosys());
			},
		};
	}

	if (!globalThis.process) {
		globalThis.process = {
			getuid() {
				return -1;
			},
			getgid() {
				return -1;
			},
			geteuid() {
				return -1;
			},
			getegid() {
				return -1;
			},
			getgroups() {
				throw enosys();
			},
			pid: -1,
			ppid: -1,
			umask() {
				throw enosys();
			},
			cwd() {
				throw enosys();
			},
			chdir() {
				throw enosys();
			},
		};
	}

	(console.error, function () {})('globalThis.fs', globalThis.fs);
	globalThis.fs.mkdirSync('/build', { recursive: true });
	globalThis.fs.mkdirSync('/build/blocks', { recursive: true });

	if (!globalThis.crypto) {
		throw new Error(
			'globalThis.crypto is not available, polyfill required (crypto.getRandomValues only)'
		);
	}

	if (!globalThis.performance) {
		throw new Error(
			'globalThis.performance is not available, polyfill required (performance.now only)'
		);
	}

	if (!globalThis.TextEncoder) {
		throw new Error(
			'globalThis.TextEncoder is not available, polyfill required'
		);
	}

	if (!globalThis.TextDecoder) {
		throw new Error(
			'globalThis.TextDecoder is not available, polyfill required'
		);
	}

	const encoder = new TextEncoder('utf-8');
	const decoder = new TextDecoder('utf-8');

	globalThis.Go = class {
		constructor() {
			this.argv = ['js'];
			this.env = {};
			this.exit = (code) => {
				if (code !== 0) {
					(console.warn, function () {})('exit code:', code);
				}
			};
			this._exitPromise = new Promise((resolve) => {
				this._resolveExitPromise = resolve;
			});
			this._pendingEvent = null;
			this._scheduledTimeouts = new Map();
			this._nextCallbackTimeoutID = 1;

			const setInt64 = (addr, v) => {
				this.mem.setUint32(addr + 0, v, true);
				this.mem.setUint32(addr + 4, Math.floor(v / 4294967296), true);
			};

			const setInt32 = (addr, v) => {
				this.mem.setUint32(addr + 0, v, true);
			};

			const getInt64 = (addr) => {
				const low = this.mem.getUint32(addr + 0, true);
				const high = this.mem.getInt32(addr + 4, true);
				return low + high * 4294967296;
			};

			const loadValue = (addr) => {
				const f = this.mem.getFloat64(addr, true);
				if (f === 0) {
					return undefined;
				}
				if (!isNaN(f)) {
					return f;
				}

				const id = this.mem.getUint32(addr, true);
				return this._values[id];
			};

			const storeValue = (addr, v) => {
				const nanHead = 0x7ff80000;

				if (typeof v === 'number' && v !== 0) {
					if (isNaN(v)) {
						this.mem.setUint32(addr + 4, nanHead, true);
						this.mem.setUint32(addr, 0, true);
						return;
					}
					this.mem.setFloat64(addr, v, true);
					return;
				}

				if (v === undefined) {
					this.mem.setFloat64(addr, 0, true);
					return;
				}

				let id = this._ids.get(v);
				if (id === undefined) {
					id = this._idPool.pop();
					if (id === undefined) {
						id = this._values.length;
					}
					this._values[id] = v;
					this._goRefCounts[id] = 0;
					this._ids.set(v, id);
				}
				this._goRefCounts[id]++;
				let typeFlag = 0;
				switch (typeof v) {
					case 'object':
						if (v !== null) {
							typeFlag = 1;
						}
						break;
					case 'string':
						typeFlag = 2;
						break;
					case 'symbol':
						typeFlag = 3;
						break;
					case 'function':
						typeFlag = 4;
						break;
				}
				this.mem.setUint32(addr + 4, nanHead | typeFlag, true);
				this.mem.setUint32(addr, id, true);
			};

			const loadSlice = (addr) => {
				const array = getInt64(addr + 0);
				const len = getInt64(addr + 8);
				return new Uint8Array(
					this._inst.exports.mem.buffer,
					array,
					len
				);
			};

			const loadSliceOfValues = (addr) => {
				const array = getInt64(addr + 0);
				const len = getInt64(addr + 8);
				const a = new Array(len);
				for (let i = 0; i < len; i++) {
					a[i] = loadValue(array + i * 8);
				}
				return a;
			};

			const loadString = (addr) => {
				const saddr = getInt64(addr + 0);
				const len = getInt64(addr + 8);
				return decoder.decode(
					new DataView(this._inst.exports.mem.buffer, saddr, len)
				);
			};

			const timeOrigin = Date.now() - performance.now();
			this.importObject = {
				_gotest: {
					add: (a, b) => a + b,
				},
				gojs: {
					// Go's SP does not change as long as no Go code is running. Some operations (e.g. calls, getters and setters)
					// may synchronously trigger a Go event handler. This makes Go code get executed in the middle of the imported
					// function. A goroutine can switch to a new stack if the current stack is too small (see morestack function).
					// This changes the SP, thus we have to update the SP used by the imported function.

					// func wasmExit(code int32)
					'runtime.wasmExit': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] runtime.wasmExit'
						);
						sp >>>= 0;
						const code = this.mem.getInt32(sp + 8, true);
						this.exited = true;
						delete this._inst;
						delete this._values;
						delete this._goRefCounts;
						delete this._ids;
						delete this._idPool;
						this.exit(code);
					},

					// func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
					'runtime.wasmWrite': (sp) => {
						sp >>>= 0;
						const fd = getInt64(sp + 8);
						const p = getInt64(sp + 16);
						const n = this.mem.getInt32(sp + 24, true);
						// (console.error,function(){})('[wasm-exec] runtime.wasmWrite fd=' + fd);
						// (console.error,function(){})(
						// 	'[wasm-exec] buffer=',
						// 	Array.from(
						// 		new Uint8Array(
						// 			this._inst.exports.mem.buffer,
						// 			p,
						// 			n
						// 		).slice(0, 100)
						// 	).join(',')
						// );
						if (!('writeSync' in globalThis.fs)) {
							(console.error, function () {})(
								'globalThis.fs.writeSync is not available!!!',
								Object.keys(globalThis.fs).join(',')
							);
						}
						if (this._inst) {
							// debugger;
							globalThis.fs.writeSync(
								fd,
								new Uint8Array(
									this._inst.exports.mem.buffer,
									p,
									n
								)
							);
						} else {
							(console.error, function () {})(
								'this._inst is not available!!!'
							);
						}
					},

					// func resetMemoryDataView()
					'runtime.resetMemoryDataView': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] runtime.resetMemoryDataView'
						);
						sp >>>= 0;
						this.mem = new DataView(this._inst.exports.mem.buffer);
					},

					// func nanotime1() int64
					'runtime.nanotime1': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] runtime.nanotime1'
						);
						sp >>>= 0;
						setInt64(
							sp + 8,
							(timeOrigin + performance.now()) * 1000000
						);
					},

					// func walltime() (sec int64, nsec int32)
					'runtime.walltime': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] runtime.walltime'
						);
						sp >>>= 0;
						const msec = new Date().getTime();
						setInt64(sp + 8, msec / 1000);
						this.mem.setInt32(
							sp + 16,
							(msec % 1000) * 1000000,
							true
						);
					},

					// func scheduleTimeoutEvent(delay int64) int32
					'runtime.scheduleTimeoutEvent': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] runtime.scheduleTimeoutEvent'
						);
						sp >>>= 0;
						const id = this._nextCallbackTimeoutID;
						this._nextCallbackTimeoutID++;
						const delay = getInt64(sp + 8);
						(console.error, function () {})(
							'[wasm-exec] scheduleTimeoutEvent',
							{
								id,
								delay,
								pendingEvent: this._pendingEvent
									? { id: this._pendingEvent.id ?? null }
									: null,
								scheduledTimeouts:
									this._scheduledTimeouts?.size ?? 0,
							}
						);
						setTimeout(() => {
							(console.error, function () {})('timeouts work');
						});
						this._scheduledTimeouts.set(
							id,
							setTimeout(() => {
								(console.error, function () {})(
									'[wasm-exec] scheduleTimeoutEvent firing',
									{
										id,
										pendingEvent: this._pendingEvent
											? {
													id:
														this._pendingEvent.id ??
														null,
											  }
											: null,
										scheduledTimeouts:
											this._scheduledTimeouts?.size ?? 0,
									}
								);
								this._resume();
								while (this._scheduledTimeouts.has(id)) {
									// for some reason Go failed to register the timeout event, log and try again
									// (temporary workaround for https://github.com/golang/go/issues/28975)
									(console.warn, function () {})(
										'scheduleTimeoutEvent: missed timeout event'
									);
									this._resume();
								}
							}, 0)
						);
						this.mem.setInt32(sp + 16, id, true);
					},

					// func clearTimeoutEvent(id int32)
					'runtime.clearTimeoutEvent': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] runtime.clearTimeoutEvent'
						);
						sp >>>= 0;
						const id = this.mem.getInt32(sp + 8, true);
						(console.error, function () {})(
							'[wasm-exec] clearTimeoutEvent',
							{
								id,
								scheduled:
									this._scheduledTimeouts?.has(id) ?? false,
							}
						);
						clearTimeout(this._scheduledTimeouts.get(id));
						this._scheduledTimeouts.delete(id);
					},

					// func getRandomData(r []byte)
					'runtime.getRandomData': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] runtime.getRandomData'
						);
						sp >>>= 0;
						crypto.getRandomValues(loadSlice(sp + 8));
					},

					// func finalizeRef(v ref)
					'syscall/js.finalizeRef': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.finalizeRef'
						);
						sp >>>= 0;
						const id = this.mem.getUint32(sp + 8, true);
						this._goRefCounts[id]--;
						if (this._goRefCounts[id] === 0) {
							const v = this._values[id];
							this._values[id] = null;
							this._ids.delete(v);
							this._idPool.push(id);
						}
					},

					// func stringVal(value string) ref
					'syscall/js.stringVal': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.stringVal'
						);
						sp >>>= 0;
						storeValue(sp + 24, loadString(sp + 8));
					},

					// func valueGet(v ref, p string) ref
					'syscall/js.valueGet': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueGet'
						);
						sp >>>= 0;
						const result = Reflect.get(
							loadValue(sp + 8),
							loadString(sp + 16)
						);
						sp = this._inst.exports.getsp() >>> 0; // see comment above
						storeValue(sp + 32, result);
					},

					// func valueSet(v ref, p string, x ref)
					'syscall/js.valueSet': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueSet'
						);
						sp >>>= 0;
						Reflect.set(
							loadValue(sp + 8),
							loadString(sp + 16),
							loadValue(sp + 32)
						);
					},

					// func valueDelete(v ref, p string)
					'syscall/js.valueDelete': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueDelete'
						);
						sp >>>= 0;
						Reflect.deleteProperty(
							loadValue(sp + 8),
							loadString(sp + 16)
						);
					},

					// func valueIndex(v ref, i int) ref
					'syscall/js.valueIndex': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueIndex'
						);
						sp >>>= 0;
						storeValue(
							sp + 24,
							Reflect.get(loadValue(sp + 8), getInt64(sp + 16))
						);
					},

					// valueSetIndex(v ref, i int, x ref)
					'syscall/js.valueSetIndex': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueSetIndex'
						);
						sp >>>= 0;
						Reflect.set(
							loadValue(sp + 8),
							getInt64(sp + 16),
							loadValue(sp + 24)
						);
					},

					// func valueCall(v ref, m string, args []ref) (ref, bool)
					'syscall/js.valueCall': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueCall'
						);
						sp >>>= 0;
						try {
							const v = loadValue(sp + 8);
							const methodName = loadString(sp + 16);
							const args = loadSliceOfValues(sp + 32);
							try {
								(console.error, function () {})(
									'[wasm-exec] valueCall target',
									{
										methodName,
										argTypes: args.map((arg) =>
											arg && arg.constructor
												? arg.constructor.name
												: typeof arg
										),
										argPreview: args.map((arg) => {
											if (typeof arg === 'string') {
												return arg.slice(0, 200);
											}
											if (
												typeof arg === 'number' ||
												typeof arg === 'boolean'
											) {
												return arg;
											}
											if (
												arg &&
												typeof Buffer !== 'undefined' &&
												Buffer.isBuffer(arg)
											) {
												return Buffer.from(arg)
													.toString('hex')
													.slice(0, 80);
											}
											return null;
										}),
									}
								);
							} catch {}
							const m = Reflect.get(v, methodName);
							(console.error, function () {})(
								'valueCall, getsp()'
							);
							const result = Reflect.apply(m, v, args);
							sp = this._inst.exports.getsp() >>> 0; // see comment above
							(console.error, function () {})(
								'sp after getsp()',
								sp
							);
							storeValue(sp + 56, result);
							this.mem.setUint8(sp + 64, 1);
						} catch (err) {
							sp = this._inst.exports.getsp() >>> 0; // see comment above
							storeValue(sp + 56, err);
							this.mem.setUint8(sp + 64, 0);
						}
					},

					// func valueInvoke(v ref, args []ref) (ref, bool)
					'syscall/js.valueInvoke': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueInvoke'
						);
						sp >>>= 0;
						try {
							const v = loadValue(sp + 8);
							const args = loadSliceOfValues(sp + 16);
							const result = Reflect.apply(v, undefined, args);
							sp = this._inst.exports.getsp() >>> 0; // see comment above
							storeValue(sp + 40, result);
							this.mem.setUint8(sp + 48, 1);
						} catch (err) {
							sp = this._inst.exports.getsp() >>> 0; // see comment above
							storeValue(sp + 40, err);
							this.mem.setUint8(sp + 48, 0);
						}
					},

					// func valueNew(v ref, args []ref) (ref, bool)
					'syscall/js.valueNew': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueNew'
						);
						sp >>>= 0;
						try {
							const v = loadValue(sp + 8);
							const args = loadSliceOfValues(sp + 16);
							(console.error, function () {})(
								'valueNew, getsp()'
							);
							const result = Reflect.construct(v, args);
							sp = this._inst.exports.getsp() >>> 0; // see comment above
							(console.error, function () {})(
								'sp after getsp()',
								sp
							);
							storeValue(sp + 40, result);
							this.mem.setUint8(sp + 48, 1);
						} catch (err) {
							sp = this._inst.exports.getsp() >>> 0; // see comment above
							storeValue(sp + 40, err);
							this.mem.setUint8(sp + 48, 0);
						}
					},

					// func valueLength(v ref) int
					'syscall/js.valueLength': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueLength'
						);
						sp >>>= 0;
						setInt64(sp + 16, parseInt(loadValue(sp + 8).length));
					},

					// valuePrepareString(v ref) (ref, int)
					'syscall/js.valuePrepareString': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valuePrepareString'
						);
						sp >>>= 0;
						const str = encoder.encode(String(loadValue(sp + 8)));
						storeValue(sp + 16, str);
						setInt64(sp + 24, str.length);
					},

					// valueLoadString(v ref, b []byte)
					'syscall/js.valueLoadString': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueLoadString'
						);
						sp >>>= 0;
						const str = loadValue(sp + 8);
						loadSlice(sp + 16).set(str);
					},

					// func valueInstanceOf(v ref, t ref) bool
					'syscall/js.valueInstanceOf': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.valueInstanceOf'
						);
						sp >>>= 0;
						this.mem.setUint8(
							sp + 24,
							loadValue(sp + 8) instanceof loadValue(sp + 16)
								? 1
								: 0
						);
					},

					// func copyBytesToGo(dst []byte, src ref) (int, bool)
					'syscall/js.copyBytesToGo': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.copyBytesToGo'
						);
						sp >>>= 0;
						const dst = loadSlice(sp + 8);
						const src = loadValue(sp + 32);
						if (
							!(
								src instanceof Uint8Array ||
								src instanceof Uint8ClampedArray
							)
						) {
							this.mem.setUint8(sp + 48, 0);
							return;
						}
						const toCopy = src.subarray(0, dst.length);
						dst.set(toCopy);
						setInt64(sp + 40, toCopy.length);
						this.mem.setUint8(sp + 48, 1);
					},

					// func copyBytesToJS(dst ref, src []byte) (int, bool)
					'syscall/js.copyBytesToJS': (sp) => {
						(console.error, function () {})(
							'[wasm-exec] syscall/js.copyBytesToJS'
						);
						sp >>>= 0;
						const dst = loadValue(sp + 8);
						const src = loadSlice(sp + 16);
						if (
							!(
								dst instanceof Uint8Array ||
								dst instanceof Uint8ClampedArray
							)
						) {
							this.mem.setUint8(sp + 48, 0);
							return;
						}
						const toCopy = src.subarray(0, dst.length);
						dst.set(toCopy);
						setInt64(sp + 40, toCopy.length);
						this.mem.setUint8(sp + 48, 1);
					},

					debug: (value) => {
						(console.error, function () {})(value);
					},
				},
			};
		}

		async run(instance) {
			if (!(instance instanceof WebAssembly.Instance)) {
				throw new Error('Go.run: WebAssembly.Instance expected');
			}
			this._inst = instance;
			this.mem = new DataView(this._inst.exports.mem.buffer);
			this._values = [
				// JS values that Go currently has references to, indexed by reference id
				NaN,
				0,
				null,
				true,
				false,
				globalThis,
				this,
			];
			this._goRefCounts = new Array(this._values.length).fill(Infinity); // number of references that Go has to a JS value, indexed by reference id
			this._ids = new Map([
				// mapping from JS values to reference ids
				[0, 1],
				[null, 2],
				[true, 3],
				[false, 4],
				[globalThis, 5],
				[this, 6],
			]);
			this._idPool = []; // unused ids that have been garbage collected
			this.exited = false; // whether the Go program has exited

			// Pass command line arguments and environment variables to WebAssembly by writing them to the linear memory.
			let offset = 4096;

			const strPtr = (str) => {
				const ptr = offset;
				const bytes = encoder.encode(str + '\0');
				new Uint8Array(this.mem.buffer, offset, bytes.length).set(
					bytes
				);
				offset += bytes.length;
				if (offset % 8 !== 0) {
					offset += 8 - (offset % 8);
				}
				return ptr;
			};

			const argc = this.argv.length;
			// (console.error,function(){})('this.argv', this.argv);
			// debugger;
			// throw new Error();
			// return;

			const argvPtrs = [];
			this.argv.forEach((arg) => {
				argvPtrs.push(strPtr(arg));
			});
			argvPtrs.push(0);

			const keys = Object.keys(this.env).sort();
			keys.forEach((key) => {
				argvPtrs.push(strPtr(`${key}=${this.env[key]}`));
			});
			argvPtrs.push(0);

			const argv = offset;
			argvPtrs.forEach((ptr) => {
				this.mem.setUint32(offset, ptr, true);
				this.mem.setUint32(offset + 4, 0, true);
				offset += 8;
			});

			// The linker guarantees global data starts from at least wasmMinDataAddr.
			// Keep in sync with cmd/link/internal/ld/data.go:wasmMinDataAddr.
			const wasmMinDataAddr = 4096 + 8192;
			if (offset >= wasmMinDataAddr) {
				throw new Error(
					'total length of command line and environment variables exceeds limit'
				);
			}

			(console.error, function () {})(
				'[wasm-exec] Go.run! about to call exports.run',
				{
					argc,
					argvCount: argvPtrs.length,
				}
			);
			this._inst.exports.run(argc, argv);
			(console.error, function () {})(
				'[wasm-exec] Go.run! returned from exports.run',
				{
					exited: this.exited,
					pendingEvent: this._pendingEvent ? true : false,
					scheduledTimeouts: this._scheduledTimeouts?.size ?? 0,
				}
			);
			setInterval(() => {
				(console.error, function () {})('[wasm-exec] Go.run interval', {
					exited: this.exited,
					pendingEvent: this._pendingEvent ? true : false,
					scheduledTimeouts: this._scheduledTimeouts?.size ?? 0,
				});
			}, 1000);
			if (this.exited) {
				this._resolveExitPromise();
			}
			(console.error, function () {})(
				'waiting for exit promise',
				this._exitPromise
			);
			await this._exitPromise;
			(console.error, function () {})(
				'exit promise resolved',
				this._exitPromise
			);
		}

		_resume() {
			if (this.exited) {
				throw new Error('Go program has already exited');
			}
			(console.error, function () {})('[wasm-exec] Go._resume entering', {
				exited: this.exited,
				pendingEvent: this._pendingEvent ? true : false,
				scheduledTimeouts: this._scheduledTimeouts?.size ?? 0,
			});
			this._inst.exports.resume();
			(console.error, function () {})('[wasm-exec] Go._resume exited', {
				exited: this.exited,
				pendingEvent: this._pendingEvent ? true : false,
				scheduledTimeouts: this._scheduledTimeouts?.size ?? 0,
			});
			(console.trace, function () {})('_resume trace');
			if (this.exited) {
				this._resolveExitPromise();
			}
		}

		_makeFuncWrapper(id) {
			const go = this;
			return function () {
				const event = { id: id, this: this, args: arguments };
				go._pendingEvent = event;
				go._resume();
				(console.error, function () {})(
					'returning from func wrapper',
					event.result
				);
				return event.result;
			};
		}
	};
})();
