import { createKernelFilesystem } from './kernel-filesystem.ts';
import { FileBrowser } from './file-browser.ts';
import { CodeEditor } from './code-editor.ts';
import { Terminal } from './terminal.ts';
import type { Kernel } from '../../runtime/index.ts';

export class KernelUI {
	private kernel: Kernel;
	private fileBrowser: FileBrowser | null = null;
	private codeEditor: CodeEditor | null = null;
	private terminal: Terminal | null = null;
	private currentFilePath: string | null = null;
	private currentFileContent: string = '';
	private saveTimeout: number | null = null;
	private saveStatusElement: HTMLElement | null = null;

	constructor(kernel: Kernel) {
		this.kernel = kernel;
		this.initialize();
	}

	private initialize() {
		const app = document.getElementById('app');
		if (!app) {
			throw new Error('App container not found');
		}

		app.innerHTML = `
			<div class="header">JavaScript Kernel File Browser</div>
			<div class="main-container">
				<div class="sidebar">
					<div class="sidebar-header">Files</div>
					<div id="file-browser"></div>
				</div>
				<div class="editor-container">
					<div class="editor-header">
						<div class="editor-path placeholder" id="editor-path">Select a file to edit</div>
						<div class="save-status" id="save-status"></div>
					</div>
					<div class="editor-wrapper" id="editor"></div>
				</div>
			</div>
			<div class="terminal-container">
				<div id="terminal"></div>
			</div>
		`;

		this.saveStatusElement = document.getElementById('save-status');

		// Initialize file browser
		const fileBrowserContainer = document.getElementById('file-browser');
		if (fileBrowserContainer) {
			const filesystem = createKernelFilesystem(this.kernel);
			this.fileBrowser = new FileBrowser({
				container: fileBrowserContainer,
				filesystem,
				rootPath: '/',
				onFileSelect: (path, content) => this.handleFileSelect(path, content),
			});
		}

		// Initialize code editor
		const editorContainer = document.getElementById('editor');
		if (editorContainer) {
			this.codeEditor = new CodeEditor({
				container: editorContainer,
				onChange: (content) => this.handleContentChange(content),
				onSave: (content) => this.handleSave(content),
			});
		}

		// Initialize terminal
		const terminalContainer = document.getElementById('terminal');
		if (terminalContainer) {
			this.terminal = new Terminal({
				container: terminalContainer,
				onInput: (data) => this.handleTerminalInput(data),
			});

			// Hook up to the worker's stdout/stderr
			this.setupTerminalConnection();
		}
	}

	private handleFileSelect(path: string, content: string) {
		this.currentFilePath = path;
		this.currentFileContent = content;

		const pathElement = document.getElementById('editor-path');
		if (pathElement) {
			pathElement.textContent = path;
			pathElement.classList.remove('placeholder');
		}

		this.codeEditor?.setContent(path, content);
		this.updateSaveStatus('idle');
	}

	private handleContentChange(content: string) {
		this.currentFileContent = content;
		this.updateSaveStatus('pending');

		// Auto-save after 1.5 seconds of no changes
		if (this.saveTimeout !== null) {
			clearTimeout(this.saveTimeout);
		}

		this.saveTimeout = window.setTimeout(() => {
			this.saveCurrentFile();
		}, 1500);
	}

	private handleSave(content: string) {
		this.currentFileContent = content;
		if (this.saveTimeout !== null) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		this.saveCurrentFile();
	}

	private async saveCurrentFile() {
		if (!this.currentFilePath) return;

		this.updateSaveStatus('saving');

		try {
			const filesystem = createKernelFilesystem(this.kernel);
			await filesystem.writeFile(this.currentFilePath, this.currentFileContent);
			this.updateSaveStatus('saved');

			// Clear "saved" status after 2 seconds
			setTimeout(() => {
				this.updateSaveStatus('idle');
			}, 2000);
		} catch (error) {
			console.error('Failed to save file:', error);
			this.updateSaveStatus('error');
		}
	}

	private updateSaveStatus(status: 'idle' | 'pending' | 'saving' | 'saved' | 'error') {
		if (!this.saveStatusElement) return;

		this.saveStatusElement.className = 'save-status';
		switch (status) {
			case 'pending':
			case 'saving':
				this.saveStatusElement.textContent = 'Saving...';
				this.saveStatusElement.classList.add('saving');
				break;
			case 'saved':
				this.saveStatusElement.textContent = 'Saved';
				this.saveStatusElement.classList.add('saved');
				break;
			case 'error':
				this.saveStatusElement.textContent = 'Save failed';
				this.saveStatusElement.classList.add('error');
				break;
			default:
				this.saveStatusElement.textContent = '';
				break;
		}
	}

	private setupTerminalConnection() {
		if (!this.terminal) return;

		// Listen for messages from the worker
		self.addEventListener('message', (event) => {
			if (event.data.type === 'stdout') {
				const text =
					typeof event.data.data === 'string'
						? event.data.data
						: new TextDecoder().decode(event.data.data);
				this.terminal?.write(text);
			} else if (event.data.type === 'stderr') {
				const text =
					typeof event.data.data === 'string'
						? event.data.data
						: new TextDecoder().decode(event.data.data);
				this.terminal?.writeError(text);
			} else if (event.data.type === 'exit') {
				this.terminal?.writeLine(`\nProcess exited with code ${event.data.data}`);
			}
		});

		this.terminal.writeLine('Terminal ready. Shell is running...');
	}

	private handleTerminalInput(data: string) {
		// Send input to the worker
		self.postMessage({ type: 'stdin', data });
	}

	public destroy() {
		if (this.saveTimeout !== null) {
			clearTimeout(this.saveTimeout);
		}
		this.codeEditor?.destroy();
		this.terminal?.destroy();
	}
}
