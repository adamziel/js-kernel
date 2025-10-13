import { defineConfig } from 'vite'

export default defineConfig({
	root: __dirname,
	server: {
		open: 'index.html',
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


