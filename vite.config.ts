import { defineConfig } from 'vite'

export default defineConfig({
	root: __dirname,
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


