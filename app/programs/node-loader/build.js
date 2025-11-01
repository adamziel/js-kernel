import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

// Check if watch mode is enabled
const isWatchMode =
	process.argv.includes('--watch') || process.argv.includes('-w');

if (!isWatchMode) {
	fs.rmSync('dist', { recursive: true, force: true });
	fs.mkdirSync('dist');
}

// const buildOptionsApp = {
// 	entryPoints: {
// 		api: './src/this-is-bundled/app/api.ts',
// 		'main-worker': './src/this-is-bundled/app/main-worker.ts',
// 		'in-memory-fs.client': './src/this-is-bundled/app/in-memory-fs.client.js',
// 		'in-memory-fs': './src/this-is-bundled/app/in-memory-fs.js',
// 		'in-memory-fs.worker': './src/this-is-bundled/app/in-memory-fs.worker.js',
// 		'node-process.worker': './src/this-is-bundled/app/node-process.worker.js',
// 		'ui/StoredHistory': './src/this-is-bundled/app/ui/StoredHistory.ts',
// 		'spawn-node-process': './src/this-is-bundled/app/spawn-node-process.ts',
// 	},
// 	bundle: true,
// 	outdir: './dist/app',
// 	format: 'esm',
// 	platform: 'browser',
// 	splitting: true,
// 	external: [
// 		'worker_threads',
// 		'/src/this-is-imported-directly/client-boot.js'
// 	],
// 	define: {
// 		process: 'globalThis.process',
// 	},
// }

const entryPoints = {
	child_process: './src/this-is-bundled/node-lib/child_process.js',
	primordials: './node/lib/internal/per_context/primordials.js',
	realm: './node/lib/internal/bootstrap/realm.js',
	async_hooks: './node/lib/async_hooks.js',
	assert: './node/lib/assert.js',
	'assert/strict': './node/lib/assert/strict.js',
	buffer: './node/lib/buffer.js',
	'internal/buffer': './node/lib/internal/buffer.js',
	// buffer: './src/this-is-bundled/node-lib/buffer.js',
	blob: './node/lib/internal/blob.js',
	console: './node/lib/console.js',
	constants: './node/lib/constants.js',
	'internal/constants': './node/lib/internal/constants.js',
	'internal/modules/cjs/loader':
		'./src/this-is-bundled/node-lib/internal/modules/cjs/loader.js',
	process: './src/this-is-bundled/node-lib/process.js',
	'internal/process/pre_execution':
		'./node/lib/internal/process/pre_execution.js',
	'internal/resolve': './src/this-is-bundled/node-lib/resolve.js',
	'fetch-polyfill': './src/this-is-bundled/node-lib/fetch-polyfill.js',
	// crypto: './node/lib/crypto.js',
	crypto: './src/this-is-bundled/node-lib/crypto.js',
	events: './node/lib/events.js',
	errors: './node/lib/internal/errors.js',
	// http: './node/lib/http.js',
	_http_agent: './node/lib/_http_agent.js',
	http: './src/this-is-bundled/node-lib/http.js',
	https: './src/this-is-bundled/node-lib/http.js',
	// https: './node/lib/https.js',
	fs: './node/lib/fs.js',
	'fs/promises': './node/lib/internal/fs/promises.js',
	os: './node/lib/os.js',
	// module: './src/this-is-bundled/node-lib/module.js',
	querystring: './node/lib/querystring.js',
	stream: './node/lib/stream.js',
	string_decoder: './node/lib/string_decoder.js',
	diagnostics_channel: './node/lib/diagnostics_channel.js',
	'internal/worker/messaging': './node/lib/internal/worker/messaging.js',
	'internal/event_target': './node/lib/internal/event_target.js',
	timers: './node/lib/timers.js',
	'timers/promises': './node/lib/timers/promises.js',
	tty: './node/lib/tty.js',
	// url: './node/lib/url.js',
	url: './src/this-is-bundled/node-lib/url.js',
	'internal/url': './src/this-is-bundled/node-lib/internal/url.js',
	perf_hooks: './node/lib/perf_hooks.js',
	string_decoder: './node/lib/string_decoder.js',
	util: './node/lib/util.js',
	'util/types': './node/lib/internal/util/types.js',
	'internal/types': './node/lib/internal/util/types.js',
	'util/inspect': './node/lib/internal/util/inspect.js',
	// zlib: './node/lib/zlib.js',
	zlib: './src/this-is-bundled/node-lib/zlib.js',
	'stream/web': './node/lib/stream/web.js',
	vm: './src/this-is-bundled/node-lib/vm.js',
	v8: './src/this-is-bundled/node-lib/v8.js',
	'internal/util/debuglog': './node/lib/internal/util/debuglog.js',
	// module: './node/lib/module.js',
	// child_process: './node/lib/child_process.js',
	net: './node/lib/net.js',
	tls: './node/lib/tls.js',
	worker_threads: './node/lib/worker_threads.js',
	dns: './node/lib/dns.js',
	http2: './node/lib/http2.js',
	// v8: './node/lib/v8.js',
	readline: './node/lib/readline.js',
	'readline/promises': './node/lib/readline/promises.js',
	path: './node/lib/path.js',
	'path/posix': './node/lib/path/posix.js',
	'path/win32': './node/lib/path/win32.js',
	// 'assert/strict': '.build-tmp/assert-strict.js',
	// 'dns/promises': '.build-tmp/dns-promises.js',
	// 'util/types': '.build-tmp/util-types.js',
};

const nodePolyfillPlugin = {
	name: 'node-polyfill',
	setup(build) {
		const nodeBuiltins = Object.keys(entryPoints);
		const filter = new RegExp(`^(node:)?(${nodeBuiltins.join('|')})$`);
		build.onResolve({ filter }, (args) => {
			const modulePath = args.path.startsWith('node:')
				? args.path.slice(5)
				: args.path;
			if (entryPoints[modulePath]) {
				return { path: path.resolve(entryPoints[modulePath]) };
			}
		});

		// Plugin to append module.exports to realm.js
		build.onLoad({ filter: /realm\.js$/ }, (args) => {
			const content = fs.readFileSync(args.path, 'utf8');
			// Append module.exports = loaderExports to the end of the realm.js file
			const modifiedContent =
				content + '\nmodule.exports = loaderExports;';
			return {
				contents: modifiedContent,
				loader: 'default',
			};
		});
	},
};

const buildOptionsNode = {
	entryPoints,
	bundle: true,
	outdir: './dist',
	format: 'esm',
	platform: 'browser',
	splitting: true,
	plugins: [nodePolyfillPlugin],
	define: {
		process: 'globalThis.process',
	},
};

async function main() {
	if (isWatchMode) {
		console.log('🔍 Starting watch mode...');
		const ctx1 = await esbuild.context(buildOptionsNode);
		await ctx1.watch();

		// const ctx2 = await esbuild.context(buildOptionsApp)
		// await ctx2.watch();
		console.log('👀 Watching for changes...');

		// Keep the process alive
		process.on('SIGINT', async () => {
			console.log('\n🛑 Stopping watch mode...');
			await ctx.dispose();
			process.exit(0);
		});
	} else {
		try {
			await esbuild.build(buildOptionsNode);
			console.log('✅ Build completed successfully');
		} catch (error) {
			console.error('❌ Build failed:', error);
			process.exit(1);
		} finally {
			// Clean up temporary files
			fs.rmSync('.build-tmp', { recursive: true, force: true });
		}
	}
}

main().catch((error) => {
	console.error('❌ Error:', error);
	process.exit(1);
});
