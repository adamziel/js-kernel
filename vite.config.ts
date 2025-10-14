import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import { defineConfig } from 'vite'
import type { Connect } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

const workspaceRoot = fileURLToPath(new URL('.', import.meta.url))
const appRoot = path.resolve(workspaceRoot, 'app')
const runtimeRoot = path.resolve(workspaceRoot, 'runtime')

// Permissive CORS proxy middleware
const corsProxyMiddleware: Connect.NextHandleFunction = async (req, res, next) => {
	const request = req as IncomingMessage
	const response = res as ServerResponse
	
	// Only handle requests to /proxy path
	if (!request.url?.startsWith('/proxy')) {
		return next()
	}

	// Parse target URL from query parameter or X-Proxy-Target header
	const url = new URL(request.url, `http://${request.headers.host}`)
	const targetUrl = url.searchParams.get('url') || request.headers['x-proxy-target']

	if (!targetUrl || typeof targetUrl !== 'string') {
		response.statusCode = 400
		response.end(JSON.stringify({ error: 'Missing target URL. Use ?url= or X-Proxy-Target header' }))
		return
	}

	try {
		// Prepare headers for the proxied request
		const proxyHeaders: HeadersInit = {}
		
		// Copy relevant headers from the original request
		Object.entries(request.headers).forEach(([key, value]) => {
			// Skip headers that shouldn't be forwarded
			if (!['host', 'connection', 'x-proxy-target'].includes(key.toLowerCase())) {
				if (Array.isArray(value)) {
					proxyHeaders[key] = value.join(', ')
				} else if (value) {
					proxyHeaders[key] = value as string
				}
			}
		})

		// Collect request body if present
		let body: typeof Buffer | undefined
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			const chunks: Buffer[] = []
			for await (const chunk of request) {
				chunks.push(Buffer.from(chunk as Buffer))
			}
			body = Buffer.concat(chunks)
		}

		// Make the proxied request
		const fetchResponse = await fetch(targetUrl, {
			method: request.method,
			headers: proxyHeaders,
			body: body,
			// @ts-ignore - Node.js fetch supports duplex
			duplex: 'half',
		})

		// Set permissive CORS headers
		response.setHeader('Access-Control-Allow-Origin', '*')
		response.setHeader('Access-Control-Allow-Methods', '*')
		response.setHeader('Access-Control-Allow-Headers', '*')
		response.setHeader('Access-Control-Expose-Headers', '*')
		response.setHeader('Access-Control-Max-Age', '86400')

		// Handle preflight requests
		if (request.method === 'OPTIONS') {
			response.statusCode = 204
			response.end()
			return
		}

		// Copy response status
		response.statusCode = fetchResponse.status

		// Copy response headers (except encoding-related ones since fetch auto-decodes)
		fetchResponse.headers.forEach((value, key) => {
			// Skip encoding headers as fetch API already decoded the response
			const lowerKey = key.toLowerCase()
			if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(lowerKey)) {
				response.setHeader(key, value)
			}
		})

		// Stream response body
		if (fetchResponse.body) {
			const reader = fetchResponse.body.getReader()
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				response.write(Buffer.from(value))
			}
		}
		
		response.end()
	} catch (error) {
		console.error('Proxy error:', error)
		response.statusCode = 502
		response.end(JSON.stringify({ 
			error: 'Proxy request failed', 
			message: error instanceof Error ? error.message : String(error)
		}))
	}
}

export default defineConfig({
	root: appRoot,
	server: {
		open: 'index.html',
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
		fs: {
			allow: ['../../../'],
		},
	},
	plugins: [
		{
			name: 'cors-proxy',
			configureServer(server) {
				server.middlewares.use(corsProxyMiddleware)
			},
		},
	],
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
				'node-loader': path.resolve(
					appRoot,
					'programs/node-loader/node-loader.ts'
				),
			},
		},
	},
})
