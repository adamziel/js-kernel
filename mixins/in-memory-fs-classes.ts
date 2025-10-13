export type GeneralFSNode = {
	type: string
	mode: number
	atime: number
	mtime: number
	ctime: number
	birthtime: number
	content?: string
}
export interface FileNode extends GeneralFSNode {
	type: 'file'
	size?: number
	content: string
}
export interface DirectoryNode extends GeneralFSNode {
	type: 'dir'
	children: Map<string, GeneralFSNode>
}
export interface SymlinkNode extends GeneralFSNode {
	type: 'symlink'
	target: string
}

export type FSNode = FileNode | DirectoryNode | SymlinkNode

export class Stats {
	public type: string
	public mode: number
	public size: number
	public atime: Date
	public mtime: Date
	public ctime: Date
	public birthtime: Date
	public atimeMs: number
	public mtimeMs: number
	public ctimeMs: number
	public birthtimeMs: number
	constructor(node: FSNode) {
		this.type = node.type
		this.mode = node.mode
		this.size = node.type === 'file' ? node.content.length : 0
		this.atime = new Date(node.atime)
		this.mtime = new Date(node.mtime)
		this.ctime = new Date(node.ctime)
		this.birthtime = new Date(node.birthtime)
		this.atimeMs = this.atime.getTime()
		this.mtimeMs = this.mtime.getTime()
		this.ctimeMs = this.ctime.getTime()
		this.birthtimeMs = this.birthtime.getTime()
	}
	isFile() {
		return this.type === 'file'
	}
	isDirectory() {
		return this.type === 'dir'
	}
	isSymbolicLink() {
		return this.type === 'symlink'
	}
	isBlockDevice() {
		return false
	}
	isCharacterDevice() {
		return false
	}
	isFIFO() {
		return false
	}
	isSocket() {
		return false
	}
}

export class Dirent {
	public name: string
	public type: string
	constructor(name: string, type: string) {
		this.name = name
		this.type = type
	}
	isDirectory() {
		return this.type === 'dir'
	}
	isFile() {
		return this.type === 'file'
	}
	isBlockDevice() {
		return false
	}
	isCharacterDevice() {
		return false
	}
	isFIFO() {
		return false
	}
	isSocket() {
		return false
	}
	isSymbolicLink() {
		return false
	}
}
