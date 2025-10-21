import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
	root: path.resolve(__dirname, 'runtime'),
	test: {
		browser: {
			enabled: true,
			name: 'chromium',
			provider: 'playwright',
			headless: true,
		},
		include: ['**/*.spec.ts'],
		exclude: ['node_modules', 'dist'],
	},
	server: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
	},
})
