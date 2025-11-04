// Copyright 2021 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

'use strict';

if (process.argv.length < 3) {
	console.error('usage: go_js_wasm_exec [wasm binary] [arguments]');
	process.exit(1);
}

globalThis.require = require;
globalThis.fs = require('fs'); // @TODO: why is .default needed? Shouldn't it provide the default export?
console.error('globalThis.fs', Object.keys(globalThis.fs));
console.error({ 'globalThis.fs': Object.keys(globalThis.fs) });
globalThis.TextEncoder = require('util').TextEncoder;
globalThis.TextDecoder = require('util').TextDecoder;

globalThis.performance ??= require('performance');

globalThis.crypto ??= require('crypto');

require('./wasm_exec');

const go = new Go();
console.error('[wasm-exec-node] argv', JSON.stringify(process.argv));
console.error('[wasm-exec-node] env keys', Object.keys(process.env));
const originalProcessExitForNode = process.exit.bind(process);
process.exit = (code = 0) => {
	const trace = new Error('process.exit trace');
	console.error(
		'[wasm-exec-node] process.exit',
		code,
		trace.stack || trace.message
	);
	return originalProcessExitForNode(code);
};
go.argv = process.argv.slice(2);
go.env = Object.assign({ TMPDIR: require('os').tmpdir() }, process.env);
go.exit = process.exit;
const originalRun = go.run.bind(go);
go.run = async (instance) => {
	console.error('[wasm-exec-node] go.run start');
	try {
		const result = await originalRun(instance);
		console.error('[wasm-exec-node] go.run resolved', go.exitCode);
		return result;
	} catch (err) {
		console.error(
			'[wasm-exec-node] go.run error',
			err && err.stack ? err.stack : err
		);
		throw err;
	}
};
process.on('uncaughtException', (error) => {
	console.error(
		'[wasm-exec-node] uncaughtException',
		error && error.stack ? error.stack : error
	);
});
process.on('unhandledRejection', (reason) => {
	console.error(
		'[wasm-exec-node] unhandledRejection',
		reason && reason.stack ? reason.stack : reason
	);
});
WebAssembly.instantiate(fs.readFileSync(process.argv[2]), go.importObject)
	.then((result) => {
		process.on('exit', (code) => {
			// Node.js exits if no event handler is pending
			if (code === 0 && !go.exited) {
				// deadlock, make Go print error and stack traces
				go._pendingEvent = { id: 0 };
				go._resume();
			}
		});
		return go.run(result.instance);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
