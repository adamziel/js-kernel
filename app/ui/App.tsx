import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createAsyncKernelProxy } from './kernel-proxy';
import { createKernelFilesystemAdapter } from './kernel-filesystem-adapter';
import FilePickerTree from './FilePickerTree/index.tsx';
import type { AsyncWritableFilesystem, FilePickerTreeHandle } from './FilePickerTree';
import { CodeEditor } from './code-editor';
import { Terminal } from './terminal';
import { Icon } from '@wordpress/components';
import { file as folderIcon, page as fileIcon } from '@wordpress/icons';

export function App() {
	const [filesystem, setFilesystem] =
		useState<AsyncWritableFilesystem | null>(null);
	const [currentFile, setCurrentFile] = useState<{
		path: string;
		content: string;
	} | null>(null);
	const [saveStatus, setSaveStatus] = useState<
		'idle' | 'pending' | 'saving' | 'saved' | 'error'
	>('idle');
	const workerRef = useRef<Worker | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const editorRef = useRef<CodeEditor | null>(null);
	const saveTimeoutRef = useRef<number | null>(null);
	const treeRef = useRef<FilePickerTreeHandle | null>(null);
	const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);

	useEffect(() => {
		// Create a worker for the kernel
		const worker = new Worker('./main-app.ts', {
			type: 'module',
		});

		workerRef.current = worker;

		console.log('Starting kernel worker...');

		// Wait for kernel to be ready
		let kernelReady = false;
		worker.addEventListener(
			'message',
			(event) => {
				if (event.data.type === 'stdout' && !kernelReady) {
					kernelReady = true;
					console.log('[UI] Kernel is ready!');

					// Create kernel proxy and filesystem adapter
					const kernelProxy = createAsyncKernelProxy(worker);
					const fs = createKernelFilesystemAdapter(kernelProxy);
					setFilesystem(fs);
				}
			},
			{ once: true }
		);

		// Fallback: if no stdout within 2 seconds, assume ready
		setTimeout(() => {
			if (!kernelReady) {
				kernelReady = true;
				console.log('[UI] Kernel ready timeout - proceeding anyway');

				const kernelProxy = createAsyncKernelProxy(worker);
				const fs = createKernelFilesystemAdapter(kernelProxy);
				setFilesystem(fs);
			}
		}, 2000);

		return () => {
			worker.terminate();
		};
	}, []);

	useEffect(() => {
		if (!workerRef.current || !terminalRef.current) return;

		const worker = workerRef.current;
		const terminal = terminalRef.current;

		const handleMessage = (event: MessageEvent) => {
			if (event.data.type === 'stdout') {
				const text =
					typeof event.data.data === 'string'
						? event.data.data
						: new TextDecoder().decode(event.data.data);
				terminal.write(text);
			} else if (event.data.type === 'stderr') {
				const text =
					typeof event.data.data === 'string'
						? event.data.data
						: new TextDecoder().decode(event.data.data);
				terminal.writeError(text);
			} else if (event.data.type === 'exit') {
				terminal.writeLine(
					`\nProcess exited with code ${event.data.data}`
				);
			}
		};

		worker.addEventListener('message', handleMessage);

		return () => {
			worker.removeEventListener('message', handleMessage);
		};
	}, [filesystem]);

	// Save file handler
	const saveCurrentFile = useCallback(async (content: string) => {
		if (!currentFile || !filesystem) return;

		setSaveStatus('saving');

		try {
			await filesystem.writeFile(currentFile.path, content);
			setSaveStatus('saved');

			setTimeout(() => {
				setSaveStatus('idle');
			}, 2000);
		} catch (error) {
			console.error('Failed to save file:', error);
			setSaveStatus('error');
		}
	}, [currentFile, filesystem]);

	// Handle content changes in editor
	const handleContentChange = useCallback((content: string) => {
		if (!currentFile) return;

		setCurrentFile({ ...currentFile, content });
		setSaveStatus('pending');

		if (saveTimeoutRef.current !== null) {
			clearTimeout(saveTimeoutRef.current);
		}

		saveTimeoutRef.current = window.setTimeout(() => {
			saveCurrentFile(content);
		}, 1500);
	}, [currentFile, saveCurrentFile]);

	// Handle save (Cmd/Ctrl+S)
	const handleSave = useCallback((content: string) => {
		if (saveTimeoutRef.current !== null) {
			clearTimeout(saveTimeoutRef.current);
			saveTimeoutRef.current = null;
		}
		saveCurrentFile(content);
	}, [saveCurrentFile]);

	// Initialize code editor
	useEffect(() => {
		const editorContainer = document.getElementById('editor-container');
		if (!editorContainer || editorRef.current) return;

		const editor = new CodeEditor({
			container: editorContainer,
			onChange: handleContentChange,
			onSave: handleSave,
		});

		editorRef.current = editor;

		return () => {
			// Cleanup if needed
		};
	}, [handleContentChange, handleSave]);

	// Update editor callbacks when they change
	useEffect(() => {
		if (editorRef.current) {
			editorRef.current.setOnChange(handleContentChange);
			editorRef.current.setOnSave(handleSave);
		}
	}, [handleContentChange, handleSave]);

	// Initialize terminal
	useEffect(() => {
		const terminalContainer = document.getElementById('terminal-container');
		if (!terminalContainer || terminalRef.current) return;

		const terminal = new Terminal({
			container: terminalContainer,
			onInput: handleTerminalInput,
		});

		terminalRef.current = terminal;
		terminal.writeLine('Terminal ready. Shell is running...');

		// Ensure terminal fits its container
		setTimeout(() => terminal.fit(), 0);

		return () => {
			// Cleanup if needed
		};
	}, []);

	// Update editor when current file PATH changes (not content)
	useEffect(() => {
		if (!currentFile || !editorRef.current) return;
		editorRef.current.setContent(currentFile.path, currentFile.content);
	}, [currentFile?.path]); // Only trigger when path changes, not content

	const handleFileSelect = async (path: string | null) => {
		setLastSelectedPath(path);

		if (!filesystem || !path) {
			setCurrentFile(null);
			return;
		}

		// Check if it's a directory
		try {
			const isDirectory = await filesystem.isDir(path);
			if (isDirectory) {
				// Don't try to read directories
				return;
			}

			const content = await filesystem.readFileAsText(path);
			setCurrentFile({ path, content });
			setSaveStatus('idle');
		} catch (error) {
			console.error(`Failed to read file ${path}:`, error);
			alert(`Failed to read file: ${error}`);
		}
	};

	const handleTerminalInput = (data: string) => {
		if (workerRef.current) {
			workerRef.current.postMessage({ type: 'stdin', data });
		}
	};

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				height: '100vh',
			}}
		>
			<div
				style={{
					padding: '10px',
					borderBottom: '1px solid #ccc',
					fontWeight: 'bold',
				}}
			>
				JavaScript Kernel File Browser
			</div>
			<div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
				<div
					style={{
						width: '300px',
						borderRight: '1px solid #ccc',
						display: 'flex',
						flexDirection: 'column',
					}}
				>
					<div
						style={{
							padding: '10px',
							fontWeight: 'bold',
							borderBottom: '1px solid #ccc',
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
						}}
					>
						<span>Files</span>
						<div style={{ display: 'flex', gap: '5px' }}>
							<button
								type="button"
								onClick={() => {
									if (treeRef.current) {
										treeRef.current.createFile(
											lastSelectedPath ?? undefined
										);
									}
								}}
								title="Create new file"
								style={{
									padding: '4px 8px',
									fontSize: '12px',
									cursor: 'pointer',
								}}
							>
								<Icon icon={fileIcon} size={14} />
								New File
							</button>
							<button
								type="button"
								onClick={() => {
									if (treeRef.current) {
										treeRef.current.createFolder(
											lastSelectedPath ?? undefined
										);
									}
								}}
								title="Create new folder"
								style={{
									padding: '4px 8px',
									fontSize: '12px',
									cursor: 'pointer',
								}}
							>
								<Icon icon={folderIcon} size={14} />
								New Folder
							</button>
						</div>
					</div>
					<div style={{ flex: 1, overflow: 'auto' }}>
						{filesystem && (
							<FilePickerTree
								ref={treeRef}
								filesystem={filesystem}
								root="/"
								onSelect={handleFileSelect}
								onDoubleClickFile={(path) => {
									// Double-click opens file and focuses editor
									handleFileSelect(path);
									if (editorRef.current) {
										editorRef.current.focus();
									}
								}}
							/>
						)}
					</div>
				</div>
				<div
					style={{
						flex: 1,
						display: 'flex',
						flexDirection: 'column',
					}}
				>
					<div
						style={{
							padding: '10px',
							borderBottom: '1px solid #ccc',
							display: 'flex',
							justifyContent: 'space-between',
						}}
					>
						<div style={{ color: currentFile ? '#000' : '#999' }}>
							{currentFile
								? currentFile.path
								: 'Select a file to edit'}
						</div>
						<div>
							{saveStatus === 'saving' && 'Saving...'}
							{saveStatus === 'saved' && '✓ Saved'}
							{saveStatus === 'error' && '✗ Save failed'}
						</div>
					</div>
					<div style={{ flex: 1 }} id="editor-container"></div>
				</div>
			</div>
			<div
				style={{ height: '200px', borderTop: '1px solid #ccc' }}
				id="terminal-container"
			></div>
		</div>
	);
}
