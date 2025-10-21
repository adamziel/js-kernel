import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	MessagePortReadableStream,
	MessagePortWritableStream,
	type KernelStdioChunk,
} from './message-port';

describe('MessagePort Streams - stdio Communication', () => {
	let channel: MessageChannel;

	beforeEach(() => {
		channel = new MessageChannel();
	});

	afterEach(() => {
		try {
			channel.port1.close();
			channel.port2.close();
		} catch {
			// Ports may already be closed
		}
	});

	describe('MessagePortWritableStream', () => {
		it('creates writable stream from MessagePort', () => {
			const writable = new MessagePortWritableStream(channel.port1);

			expect(writable).toBeDefined();
			expect(typeof writable.write).toBe('function');
			expect(typeof writable.end).toBe('function');
			expect(typeof writable.close).toBe('function');
		});

		it('writes string data through MessagePort', (done) => {
			const writable = new MessagePortWritableStream(channel.port1);

			channel.port2.onmessage = (event) => {
				expect(event.data.type).toBe('data');
				expect(event.data.payload).toBe('test string');
				done();
			};

			writable.write('test string');
		});

		it('writes Uint8Array data through MessagePort', (done) => {
			const writable = new MessagePortWritableStream(channel.port1);
			const data = new Uint8Array([1, 2, 3, 4, 5]);

			channel.port2.onmessage = (event) => {
				expect(event.data.type).toBe('data');
				expect(event.data.payload).toBeInstanceOf(Uint8Array);
				expect(Array.from(event.data.payload)).toEqual([1, 2, 3, 4, 5]);
				done();
			};

			writable.write(data);
		});

		it('writes multiple chunks sequentially', (done) => {
			const writable = new MessagePortWritableStream(channel.port1);
			const receivedChunks: string[] = [];

			channel.port2.onmessage = (event) => {
				if (event.data.type === 'data') {
					receivedChunks.push(event.data.payload);

					if (receivedChunks.length === 3) {
						expect(receivedChunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
						done();
					}
				}
			};

			writable.write('chunk1');
			writable.write('chunk2');
			writable.write('chunk3');
		});

		it('sends end message when stream is ended', (done) => {
			const writable = new MessagePortWritableStream(channel.port1);

			channel.port2.onmessage = (event) => {
				if (event.data.type === 'end') {
					done();
				}
			};

			writable.end();
		});

		it('sends close message when stream is closed', (done) => {
			const writable = new MessagePortWritableStream(channel.port1);

			channel.port2.onmessage = (event) => {
				if (event.data.type === 'close') {
					done();
				}
			};

			writable.close();
		});

		it('can write data and then end the stream', (done) => {
			const writable = new MessagePortWritableStream(channel.port1);
			const messages: any[] = [];

			channel.port2.onmessage = (event) => {
				messages.push(event.data);

				if (messages.length === 2) {
					expect(messages[0]).toEqual({ type: 'data', payload: 'final data' });
					expect(messages[1]).toEqual({ type: 'end' });
					done();
				}
			};

			writable.write('final data');
			writable.end();
		});

		it('emits drain event after write', (done) => {
			const writable = new MessagePortWritableStream(channel.port1);

			writable.on('drain', () => {
				done();
			});

			writable.write('test');
		});

		it('emits finish event when ended', (done) => {
			const writable = new MessagePortWritableStream(channel.port1);

			writable.on('finish', () => {
				done();
			});

			writable.end();
		});

		it('emits close event when closed', (done) => {
			const writable = new MessagePortWritableStream(channel.port1);

			writable.on('close', () => {
				done();
			});

			writable.close();
		});

		it('can destroy stream', () => {
			const writable = new MessagePortWritableStream(channel.port1);

			expect(() => writable.destroy()).not.toThrow();
		});

		it('supports debug label for logging', () => {
			const writable = new MessagePortWritableStream(
				channel.port1,
				undefined,
				'test-stream'
			);

			expect(writable).toBeDefined();
		});
	});

	describe('MessagePortReadableStream', () => {
		it('creates readable stream from MessagePort', () => {
			const readable = new MessagePortReadableStream(channel.port1);

			expect(readable).toBeDefined();
			expect(typeof readable.on).toBe('function');
			expect(typeof readable.once).toBe('function');
			expect(typeof readable.off).toBe('function');
		});

		it('receives data events from MessagePort', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			readable.on('data', (chunk) => {
				expect(chunk).toBe('test data');
				done();
			});

			channel.port2.postMessage({
				type: 'data',
				payload: 'test data',
			});
		});

		it('receives Uint8Array data', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			const testData = new Uint8Array([10, 20, 30]);

			readable.on('data', (chunk) => {
				expect(chunk).toBeInstanceOf(Uint8Array);
				expect(Array.from(chunk as Uint8Array)).toEqual([10, 20, 30]);
				done();
			});

			channel.port2.postMessage({
				type: 'data',
				payload: testData,
			});
		});

		it('receives multiple data chunks in order', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			const receivedChunks: string[] = [];

			readable.on('data', (chunk) => {
				receivedChunks.push(chunk as string);

				if (receivedChunks.length === 4) {
					expect(receivedChunks).toEqual(['a', 'b', 'c', 'd']);
					done();
				}
			});

			channel.port2.postMessage({ type: 'data', payload: 'a' });
			channel.port2.postMessage({ type: 'data', payload: 'b' });
			channel.port2.postMessage({ type: 'data', payload: 'c' });
			channel.port2.postMessage({ type: 'data', payload: 'd' });
		});

		it('emits end event when stream ends', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			readable.on('end', () => {
				done();
			});

			channel.port2.postMessage({ type: 'end' });
		});

		it('emits close event when stream closes', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			readable.on('close', () => {
				done();
			});

			channel.port2.postMessage({ type: 'close' });
		});

		it('emits data and then end events in correct order', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			const events: string[] = [];

			readable.on('data', (chunk) => {
				events.push('data:' + chunk);
			});

			readable.on('end', () => {
				events.push('end');
				expect(events).toEqual(['data:chunk1', 'data:chunk2', 'end']);
				done();
			});

			channel.port2.postMessage({ type: 'data', payload: 'chunk1' });
			channel.port2.postMessage({ type: 'data', payload: 'chunk2' });
			channel.port2.postMessage({ type: 'end' });
		});

		it('supports once() for single event listener', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			let callCount = 0;

			readable.once('data', () => {
				callCount++;
			});

			// Send multiple data events
			channel.port2.postMessage({ type: 'data', payload: 'first' });
			channel.port2.postMessage({ type: 'data', payload: 'second' });

			setTimeout(() => {
				expect(callCount).toBe(1);
				done();
			}, 100);
		});

		it('supports off() to remove event listener', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			let callCount = 0;

			const handler = () => {
				callCount++;
			};

			readable.on('data', handler);
			readable.off('data', handler);

			channel.port2.postMessage({ type: 'data', payload: 'test' });

			setTimeout(() => {
				expect(callCount).toBe(0);
				done();
			}, 100);
		});

		it('can destroy stream', () => {
			const readable = new MessagePortReadableStream(channel.port1);

			expect(() => readable.destroy()).not.toThrow();
		});

		it('reports closed state via isClosed()', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			expect(readable.isClosed()).toBe(false);

			readable.on('close', () => {
				expect(readable.isClosed()).toBe(true);
				done();
			});

			channel.port2.postMessage({ type: 'close' });
		});

		it('reports ended state via isEnded()', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			expect(readable.isEnded()).toBe(false);

			readable.on('end', () => {
				expect(readable.isEnded()).toBe(true);
				done();
			});

			channel.port2.postMessage({ type: 'end' });
		});

		it('calling close() emits close event', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			readable.on('close', () => {
				done();
			});

			readable.close();
		});
	});

	describe('Bidirectional Communication', () => {
		it('allows full-duplex communication between two streams', (done) => {
			const readable1 = new MessagePortReadableStream(channel.port1);
			const writable1 = new MessagePortWritableStream(channel.port1);

			const readable2 = new MessagePortReadableStream(channel.port2);
			const writable2 = new MessagePortWritableStream(channel.port2);

			const messages1: string[] = [];
			const messages2: string[] = [];

			readable1.on('data', (chunk) => {
				messages1.push(chunk as string);
			});

			readable2.on('data', (chunk) => {
				messages2.push(chunk as string);
			});

			// Port 1 -> Port 2
			writable1.write('hello from 1');

			// Port 2 -> Port 1
			writable2.write('hello from 2');

			setTimeout(() => {
				expect(messages1).toContain('hello from 2');
				expect(messages2).toContain('hello from 1');
				done();
			}, 100);
		});

		it('supports echo pattern (read and write back)', (done) => {
			const parentReadable = new MessagePortReadableStream(channel.port1);
			const parentWritable = new MessagePortWritableStream(channel.port1);

			const childReadable = new MessagePortReadableStream(channel.port2);
			const childWritable = new MessagePortWritableStream(channel.port2);

			// Child echoes back what it receives
			childReadable.on('data', (chunk) => {
				childWritable.write('echo:' + chunk);
			});

			// Parent sends and receives
			parentReadable.on('data', (chunk) => {
				expect(chunk).toBe('echo:test');
				done();
			});

			parentWritable.write('test');
		});

		it('handles concurrent bidirectional writes', (done) => {
			const readable1 = new MessagePortReadableStream(channel.port1);
			const writable1 = new MessagePortWritableStream(channel.port1);

			const readable2 = new MessagePortReadableStream(channel.port2);
			const writable2 = new MessagePortWritableStream(channel.port2);

			const received1: string[] = [];
			const received2: string[] = [];

			readable1.on('data', (chunk) => received1.push(chunk as string));
			readable2.on('data', (chunk) => received2.push(chunk as string));

			// Rapid bidirectional communication
			for (let i = 0; i < 10; i++) {
				writable1.write('from1:' + i);
				writable2.write('from2:' + i);
			}

			setTimeout(() => {
				expect(received1.length).toBe(10);
				expect(received2.length).toBe(10);
				expect(received1[0]).toBe('from2:0');
				expect(received2[0]).toBe('from1:0');
				expect(received1[9]).toBe('from2:9');
				expect(received2[9]).toBe('from1:9');
				done();
			}, 200);
		});
	});

	describe('Stream Lifecycle Management', () => {
		it('end followed by close emits both events', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			const events: string[] = [];

			readable.on('end', () => events.push('end'));
			readable.on('close', () => {
				events.push('close');
				expect(events).toEqual(['end', 'close']);
				done();
			});

			channel.port2.postMessage({ type: 'end' });
			channel.port2.postMessage({ type: 'close' });
		});

		it('closing readable stream notifies writable stream', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			const writable = new MessagePortWritableStream(channel.port2);

			writable.on('close', () => {
				done();
			});

			readable.close();
		});

		it('ending writable stream notifies readable stream', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			const writable = new MessagePortWritableStream(channel.port2);

			readable.on('end', () => {
				done();
			});

			writable.end();
		});

		it('destroying readable stream closes connection', () => {
			const readable = new MessagePortReadableStream(channel.port1);

			expect(readable.isClosed()).toBe(false);
			readable.destroy();

			// After destroy, stream should be in closed state
			expect(readable.isClosed()).toBe(true);
		});

		it('destroying writable stream closes connection', () => {
			const writable = new MessagePortWritableStream(channel.port1);

			expect(() => {
				writable.destroy();
				writable.write('should not work');
			}).not.toThrow();
		});
	});

	describe('Error Handling', () => {
		it('handles invalid message format gracefully', () => {
			const readable = new MessagePortReadableStream(channel.port1);
			const dataHandler = vi.fn();

			readable.on('data', dataHandler);

			// Send invalid message (missing type)
			channel.port2.postMessage({ invalid: 'message' });

			// Wait to ensure no crashes
			setTimeout(() => {
				expect(dataHandler).not.toHaveBeenCalled();
			}, 50);
		});

		it('handles MessagePort errors gracefully', () => {
			const readable = new MessagePortReadableStream(channel.port1);

			// Close port prematurely
			channel.port2.close();

			// Should not crash when trying to interact
			expect(() => readable.close()).not.toThrow();
		});

		it('writable stream handles closed port', () => {
			const writable = new MessagePortWritableStream(channel.port1);

			channel.port1.close();

			// Should not crash
			expect(() => writable.write('test')).not.toThrow();
		});
	});

	describe('Performance and Buffering', () => {
		it('handles large data chunks', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			const writable = new MessagePortWritableStream(channel.port2);

			const largeData = 'x'.repeat(100000); // 100KB string

			readable.on('data', (chunk) => {
				expect((chunk as string).length).toBe(100000);
				done();
			});

			writable.write(largeData);
		});

		it('handles rapid sequential writes', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			const writable = new MessagePortWritableStream(channel.port2);

			const receivedChunks: number[] = [];

			readable.on('data', (chunk) => {
				receivedChunks.push(parseInt(chunk as string, 10));

				if (receivedChunks.length === 100) {
					// Verify all messages received in order
					for (let i = 0; i < 100; i++) {
						expect(receivedChunks[i]).toBe(i);
					}
					done();
				}
			});

			// Send 100 messages rapidly
			for (let i = 0; i < 100; i++) {
				writable.write(String(i));
			}
		});

		it('handles mixed string and binary data', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);
			const writable = new MessagePortWritableStream(channel.port2);

			const receivedChunks: KernelStdioChunk[] = [];

			readable.on('data', (chunk) => {
				receivedChunks.push(chunk);

				if (receivedChunks.length === 4) {
					expect(receivedChunks[0]).toBe('string1');
					expect(receivedChunks[1]).toBeInstanceOf(Uint8Array);
					expect(receivedChunks[2]).toBe('string2');
					expect(receivedChunks[3]).toBeInstanceOf(Uint8Array);
					done();
				}
			});

			writable.write('string1');
			writable.write(new Uint8Array([1, 2, 3]));
			writable.write('string2');
			writable.write(new Uint8Array([4, 5, 6]));
		});
	});

	describe('Event Listener Management', () => {
		it('supports multiple listeners for same event', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			let listener1Called = false;
			let listener2Called = false;

			readable.on('data', () => {
				listener1Called = true;
			});

			readable.on('data', () => {
				listener2Called = true;
			});

			channel.port2.postMessage({ type: 'data', payload: 'test' });

			setTimeout(() => {
				expect(listener1Called).toBe(true);
				expect(listener2Called).toBe(true);
				done();
			}, 50);
		});

		it('removing one listener does not affect others', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			let listener1Count = 0;
			let listener2Count = 0;

			const listener1 = () => {
				listener1Count++;
			};
			const listener2 = () => {
				listener2Count++;
			};

			readable.on('data', listener1);
			readable.on('data', listener2);

			// Remove listener1
			readable.off('data', listener1);

			channel.port2.postMessage({ type: 'data', payload: 'test' });

			setTimeout(() => {
				expect(listener1Count).toBe(0);
				expect(listener2Count).toBe(1);
				done();
			}, 50);
		});

		it('once() listener is removed after first call', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			let callCount = 0;
			readable.once('data', () => {
				callCount++;
			});

			channel.port2.postMessage({ type: 'data', payload: 'first' });

			setTimeout(() => {
				channel.port2.postMessage({ type: 'data', payload: 'second' });

				setTimeout(() => {
					expect(callCount).toBe(1);
					done();
				}, 50);
			}, 50);
		});
	});

	describe('Stream State Tracking', () => {
		it('tracks open, ended, and closed states correctly', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			// Initially open
			expect(readable.isClosed()).toBe(false);
			expect(readable.isEnded()).toBe(false);

			// Send end
			channel.port2.postMessage({ type: 'end' });

			setTimeout(() => {
				expect(readable.isEnded()).toBe(true);
				expect(readable.isClosed()).toBe(false);

				// Send close
				channel.port2.postMessage({ type: 'close' });

				setTimeout(() => {
					expect(readable.isEnded()).toBe(true);
					expect(readable.isClosed()).toBe(true);
					done();
				}, 50);
			}, 50);
		});

		it('close without end still marks as closed', (done) => {
			const readable = new MessagePortReadableStream(channel.port1);

			channel.port2.postMessage({ type: 'close' });

			setTimeout(() => {
				expect(readable.isClosed()).toBe(true);
				done();
			}, 50);
		});
	});
});
