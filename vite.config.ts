import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const workspaceRoot = fileURLToPath(new URL('.', import.meta.url))
const appRoot = path.resolve(workspaceRoot, 'app')
const runtimeRoot = path.resolve(workspaceRoot, 'runtime')

export default defineConfig({
	root: appRoot,
	server: {
		open: 'index.html',
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
	},
	preview: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
	},
	resolve: {
		alias: {
			'@runtime': runtimeRoot,
		},
		extensions: ['.ts', '.js'],
	},
	worker: {
		format: 'es',
	},
	esbuild: {
		target: 'esnext',
	},
	build: {
		target: 'esnext',
		sourcemap: true,
	},
})

