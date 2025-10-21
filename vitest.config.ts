import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
	root: path.resolve(__dirname, 'runtime'),
	test: {
		environment: 'node',
		include: ['**/*.spec.ts'],
		exclude: ['node_modules', 'dist'],
	},
})
