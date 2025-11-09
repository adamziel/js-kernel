import type { KernelFilesystem } from './kernel-filesystem.ts';

export interface FileBrowserOptions {
	container: HTMLElement;
	filesystem: KernelFilesystem;
	rootPath: string;
	onFileSelect?: (path: string, content: string) => void;
}

interface FileTreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children?: FileTreeNode[];
	expanded?: boolean;
}

export class FileBrowser {
	private container: HTMLElement;
	private filesystem: KernelFilesystem;
	private rootPath: string;
	private onFileSelect?: (path: string, content: string) => void;
	private treeContainer: HTMLElement;
	private rootNode: FileTreeNode | null = null;
	private selectedPath: string | null = null;

	constructor(options: FileBrowserOptions) {
		this.container = options.container;
		this.filesystem = options.filesystem;
		this.rootPath = options.rootPath;
		this.onFileSelect = options.onFileSelect;
		this.treeContainer = document.createElement('div');
		this.treeContainer.className = 'file-tree';
		this.container.appendChild(this.treeContainer);
		this.initialize();
	}

	private async initialize() {
		try {
			await this.loadDirectory(this.rootPath);
			this.render();
		} catch (error) {
			console.error('[FileBrowser] Failed to initialize:', error);
		}
	}

	private async loadDirectory(path: string): Promise<FileTreeNode> {
		const name = path === this.rootPath ? 'root' : path.split('/').pop() || path;
		const node: FileTreeNode = {
			name,
			path,
			isDirectory: true,
			children: [],
			expanded: path === this.rootPath,
		};

		try {
			const entries = await this.filesystem.listFiles(path);

			const children = await Promise.all(
				entries.map(async (entry) => {
					const fullPath = `${path}/${entry}`.replace(/\/+/g, '/');
					const isDirectory = await this.filesystem.isDir(fullPath);
					return {
						name: entry,
						path: fullPath,
						isDirectory,
						expanded: false,
					};
				})
			);

			// Sort: directories first, then files, alphabetically
			children.sort((a, b) => {
				if (a.isDirectory && !b.isDirectory) return -1;
				if (!a.isDirectory && b.isDirectory) return 1;
				return a.name.localeCompare(b.name);
			});

			node.children = children;
		} catch (error) {
			console.error(`[FileBrowser] Failed to load directory ${path}:`, error);
			node.children = [];
		}

		if (path === this.rootPath) {
			this.rootNode = node;
		}

		return node;
	}

	private render() {
		if (!this.rootNode) return;
		this.treeContainer.innerHTML = '';
		this.renderNode(this.rootNode, this.treeContainer, 0);
	}

	private renderNode(node: FileTreeNode, parent: HTMLElement, depth: number) {
		const nodeElement = document.createElement('div');
		nodeElement.className = 'file-tree-node';
		nodeElement.style.paddingLeft = `${depth * 16}px`;

		const iconElement = document.createElement('span');
		iconElement.className = 'file-tree-icon';
		if (node.isDirectory) {
			iconElement.textContent = node.expanded ? '▼ ' : '▶ ';
			iconElement.style.cursor = 'pointer';
			iconElement.addEventListener('click', async (e) => {
				e.stopPropagation();
				await this.toggleNode(node);
			});
		} else {
			iconElement.textContent = '  ';
		}

		const nameElement = document.createElement('span');
		nameElement.className = 'file-tree-name';
		nameElement.textContent = node.name;
		nameElement.style.cursor = 'pointer';

		if (node.path === this.selectedPath) {
			nodeElement.classList.add('selected');
		}

		nameElement.addEventListener('click', async () => {
			if (node.isDirectory) {
				await this.toggleNode(node);
			} else {
				await this.selectFile(node);
			}
		});

		nodeElement.appendChild(iconElement);
		nodeElement.appendChild(nameElement);
		parent.appendChild(nodeElement);

		if (node.isDirectory && node.expanded && node.children) {
			for (const child of node.children) {
				this.renderNode(child, parent, depth + 1);
			}
		}
	}

	private async toggleNode(node: FileTreeNode) {
		if (!node.isDirectory) return;

		if (!node.expanded && (!node.children || node.children.length === 0)) {
			const loadedNode = await this.loadDirectory(node.path);
			// Update the node's children with the loaded data
			node.children = loadedNode.children;
		}

		node.expanded = !node.expanded;
		this.render();
	}

	private async selectFile(node: FileTreeNode) {
		if (node.isDirectory) return;

		this.selectedPath = node.path;
		this.render();

		if (this.onFileSelect) {
			try {
				const content = await this.filesystem.readFileAsText(node.path);
				this.onFileSelect(node.path, content);
			} catch (error) {
				console.error(`Failed to read file ${node.path}:`, error);
				alert(`Failed to read file: ${error}`);
			}
		}
	}

	public async refresh() {
		this.rootNode = null;
		await this.initialize();
	}
}
