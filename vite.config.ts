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
		fs: {
			allow: ['../'],
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
	assetsInclude: [/\.dat$/, /\.wasm$/],
	optimizeDeps: {
		esbuildOptions: {
			loader: {
				'.dat': 'file',
				'.wasm': 'file',
			},
		},
	},
	worker: {
		format: 'es',
	},
	esbuild: {
		target: 'esnext',
	},
	build: {
		outDir: path.resolve(workspaceRoot, 'dist'),
		target: 'esnext',
		sourcemap: true,
		emptyOutDir: true,
		rollupOptions: {
			input: {
				index: path.resolve(appRoot, 'index.html'),
				'main-app': path.resolve(appRoot, 'main-app.ts'),
				'php-loader': path.resolve(appRoot, 'programs/php-loader.ts'),
			},
		},
	},
})

