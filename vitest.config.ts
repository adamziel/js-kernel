import { defineConfig } from 'vitest/config';
import path from 'path';

const enableBrowser =
	process.env.VITEST_BROWSER === undefined ||
	process.env.VITEST_BROWSER.toLowerCase() === 'true';

export default defineConfig({
	root: path.resolve(__dirname, 'runtime'),
	test: {
		browser: {
			enabled: enableBrowser,
			name: 'chromium',
			provider: 'playwright',
			headless: true,
		},
		include: ['**/*.spec.ts', '../app/**/*.spec.ts'],
		exclude: ['node_modules', 'dist'],
		testTimeout: 30000, // Increase timeout for WASM loading
	},
	server: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
		fs: {
			allow: ['..'], // Allow serving files from parent directory
		},
	},
	optimizeDeps: {
		exclude: ['../wasmfs-module/dist/wasmfs-fs.js'],
	},
	worker: {
		format: 'es',
	},
});
