import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export interface TerminalOptions {
	container: HTMLElement;
	onInput?: (data: string) => void;
}

export class Terminal {
	private container: HTMLElement;
	private xterm: XTerm;
	private fitAddon: FitAddon;
	private onInput?: (data: string) => void;

	constructor(options: TerminalOptions) {
		this.container = options.container;
		this.onInput = options.onInput;

		// Create xterm instance with dark theme
		this.xterm = new XTerm({
			cursorBlink: true,
			theme: {
				background: '#1e1e1e',
				foreground: '#d4d4d4',
				cursor: '#d4d4d4',
				black: '#000000',
				red: '#cd3131',
				green: '#0dbc79',
				yellow: '#e5e510',
				blue: '#2472c8',
				magenta: '#bc3fbc',
				cyan: '#11a8cd',
				white: '#e5e5e5',
				brightBlack: '#666666',
				brightRed: '#f14c4c',
				brightGreen: '#23d18b',
				brightYellow: '#f5f543',
				brightBlue: '#3b8eea',
				brightMagenta: '#d670d6',
				brightCyan: '#29b8db',
				brightWhite: '#e5e5e5',
			},
			fontFamily: 'Menlo, Monaco, "Courier New", monospace',
			fontSize: 13,
			lineHeight: 1.2,
			scrollback: 10000,
		});

		// Add fit addon
		this.fitAddon = new FitAddon();
		this.xterm.loadAddon(this.fitAddon);

		// Open terminal in container
		this.xterm.open(this.container);
		this.fitAddon.fit();

		// Handle terminal input
		this.xterm.onData((data) => {
			if (this.onInput) {
				this.onInput(data);
			}
		});

		// Handle window resize
		window.addEventListener('resize', () => {
			this.fitAddon.fit();
		});

		// Initial focus
		this.xterm.focus();
	}

	public write(text: string) {
		this.xterm.write(text);
	}

	public writeLine(text: string) {
		this.xterm.writeln(text);
	}

	public writeError(text: string) {
		// Write error in red
		this.xterm.write(`\x1b[31m${text}\x1b[0m`);
	}

	public clear() {
		this.xterm.clear();
	}

	public focus() {
		this.xterm.focus();
	}

	public destroy() {
		this.xterm.dispose();
	}

	public fit() {
		this.fitAddon.fit();
	}
}
