import EventEmitter from 'events';
import type { Writable } from 'stream';

export class ReadlineWorkerBackend extends EventEmitter {
	private port: MessagePort;

	constructor(port: MessagePort) {
		super();
		this.port = port;
		this.port.onmessage = (event) => {
			if (event.data.type === 'answer') {
				this.emit('line', event.data.answer);
			}
		};
	}

	question(query: string, callback: (answer: string) => void): void {
		this.port.postMessage({ type: 'question', query });
		this.once('line', (answer) => {
			callback(answer);
		});
	}

	setOutput(output: Writable | undefined): void {
		// The worker's output is already redirected, so this is a no-op.
	}

	close(): void {
		this.port.close();
	}
}
