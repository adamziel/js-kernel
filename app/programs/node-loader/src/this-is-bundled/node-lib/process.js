let term = null;

function setTerminal(terminal) {
	term = terminal;
}

const sharedDecoder =
	typeof TextDecoder !== 'undefined' ? new TextDecoder() : undefined;

// ESM exports for process methods
const exit = (code) => {
	console.trace('exit', { code });
	emit('exit', code ?? 0);
	globalThis.processController.exit(code ?? 0);
};

const abort = () => {
	console.error('process.abort() called - aborting execution');
	throw new Error('Process aborted');
};

function chdir(directory) {
	processController.chdir(directory);
}

const cwd = () => {
	return processController.cwd();
};

const getuid = () => {
	return 1000; // Default user ID
};

const getgid = () => {
	return 1000; // Default group ID
};

const getgroups = () => {
	return [1000]; // Default groups
};

const umask = (mask) => {
	const currentMask = 0o022; // Default umask
	return mask !== undefined ? currentMask : currentMask;
};

const uptime = () => {
	return performance.now() / 1000; // Convert to seconds
};

const hrtime = (time) => {
	const now = performance.now();
	const seconds = Math.floor(now / 1000);
	const nanoseconds = Math.floor((now % 1000) * 1e6);

	if (time) {
		const diffSeconds = seconds - time[0];
		const diffNanoseconds = nanoseconds - time[1];
		return [diffSeconds, diffNanoseconds];
	}

	return [seconds, nanoseconds];
};

const memoryUsage = () => {
	// Return mock memory usage data
	return {
		rss: 50 * 1024 * 1024, // 50MB
		heapTotal: 30 * 1024 * 1024, // 30MB
		heapUsed: 20 * 1024 * 1024, // 20MB
		external: 5 * 1024 * 1024, // 5MB
		arrayBuffers: 1 * 1024 * 1024, // 1MB
	};
};

const cpuUsage = (previousValue) => {
	const mockUsage = { user: 100000, system: 50000 }; // Mock CPU usage in microseconds

	if (previousValue) {
		return {
			user: mockUsage.user - previousValue.user,
			system: mockUsage.system - previousValue.system,
		};
	}

	return mockUsage;
};

const kill = (pid, signal) => {
	console.warn(
		`process.kill(${pid}, ${signal}) called - not supported in browser environment`
	);
	return true;
};

// Event handling for process
const eventListeners = new Map();

const on = (event, listener) => {
	if (!eventListeners.has(event)) {
		eventListeners.set(event, []);
	}
	eventListeners.get(event).push(listener);

	// Handle common process events
	if (event === 'exit') {
		// Browser doesn't have a direct exit event, but we can simulate it
		globalThis.addEventListener('beforeunload', () => {
			const listeners = eventListeners.get('exit') || [];
			listeners.forEach((listener) => {
				try {
					listener(0); // Exit code 0
				} catch (e) {
					console.error('Error in exit listener:', e);
				}
			});
		});
	} else if (event === 'uncaughtException') {
		// Handle uncaught exceptions
		globalThis.addEventListener('error', (errorEvent) => {
			const listeners = eventListeners.get('uncaughtException') || [];
			listeners.forEach((listener) => {
				try {
					listener(errorEvent.error || new Error(errorEvent.message));
				} catch (e) {
					console.error('Error in uncaughtException listener:', e);
				}
			});
		});
	} else if (event === 'unhandledRejection') {
		// Handle unhandled promise rejections
		globalThis.addEventListener('unhandledrejection', (rejectionEvent) => {
			const listeners = eventListeners.get('unhandledRejection') || [];
			listeners.forEach((listener) => {
				try {
					listener(rejectionEvent.reason, rejectionEvent.promise);
				} catch (e) {
					console.error('Error in unhandledRejection listener:', e);
				}
			});
		});
	}

	return globalThis.process; // Return process object for chaining
};

const once = (event, listener) => {
	on(event, listener);
	return globalThis.process;
};

const off = (event, listener) => {
	const listeners = eventListeners.get(event);
	if (listeners) {
		const index = listeners.indexOf(listener);
		if (index > -1) {
			listeners.splice(index, 1);
		}
	}
	return globalThis.process;
};

const addListener = on;
const removeListener = off; // Alias for off

const emit = (event, ...args) => {
	const listeners = eventListeners.get(event) || [];
	listeners.forEach((listener) => {
		try {
			listener(...args);
		} catch (e) {
			console.error(`Error in ${event} listener:`, e);
			console.trace(e);
			console.log(...args);
			debugger;
		}
	});
	return listeners.length > 0;
};

const emitWarning = (warning, type, code, ctor) => {
	let warningObj;

	if (typeof warning === 'string') {
		warningObj = new Error(warning);
		warningObj.name = type || 'Warning';
		if (code) warningObj.code = code;
	} else if (warning instanceof Error) {
		warningObj = warning;
		if (type) warningObj.name = type;
		if (code) warningObj.code = code;
	} else {
		throw new TypeError(
			'The "warning" argument must be of type string or an instance of Error'
		);
	}

	// Emit the warning event
	const hasListeners = emit('warning', warningObj);

	// If no listeners, log to console
	if (!hasListeners) {
		console.warn(
			`(node:${globalThis.process?.pid || 0}) ${warningObj.name}: ${
				warningObj.message
			}`
		);
		if (warningObj.code) {
			console.warn(`[${warningObj.code}]`);
		}
	}
};

const nextTick = (fn, ...args) => {
	if (!fn) {
		console.log(fn);
		console.error('nextTick called with no function');
		return;
	}
	setTimeout(fn.bind(null, ...args), 0);
};
const version = 'v20.17.0';
const versions = {
	arch: 'x64',
	version: version,
	platform: 'darwin',
	release: {
		name: 'node',
		sourceUrl: 'https://nodejs.org/download/release/v20.17.0/',
		headersUrl:
			'https://nodejs.org/download/release/v20.17.0/headers.tar.gz',
		libUrl: 'https://nodejs.org/download/release/v20.17.0/lib.tar.gz',
	},
	modules: 'node:buffer',
	node: version,
	openssl: '3.3.2',
	uv: '1.46.0',
	v8: '11.7.50.18',
	zlib: '1.3.0',
	libc: 'glibc',
	libcxx: 'libcxx',
	libcxxabi: 'libcxxabi',
	libunwind: 'libunwind',
	libatomic: 'libatomic',
	libuv: '1.46.0',
	libvips: '8.14.2',
	libjpeg: '2.1.4',
	libpng: '1.6.39',
	libtiff: '4.5.0',
	libwebp: '1.3.2',
	libgif: '5.2.1',
	libavif: '0.13.0',
	libexif: '0.6.24',
	libheif: '1.16.2',
	libopenjpeg: '2.5.0',
	libraw: '0.21.1',
};

on('output.standard', (data) => {
	globalThis.process.stdout.write(data);
});

function makeWritable(writeFn) {
	const stream = new requireStream().Writable({
		write(chunk, encoding, callback) {
			const value =
				typeof chunk === 'string'
					? chunk
					: sharedDecoder
					? sharedDecoder.decode(chunk)
					: chunk.toString();
			if (term) {
				// xterm.js handles newlines well, but requires \r for carriage return.
				term.write(value.replace(/\n/g, '\r\n'));
			} else {
				writeFn(value);
			}
			callback();
		},
	});
	stream.isTTY = false;
	return stream;
}

let maxListeners = 50;
const setMaxListeners = (n) => {
	maxListeners = n;
	return maxListeners;
};

const getMaxListeners = () => {
	return maxListeners;
};

const features = {
	openssl_is_boringssl: false,
};

const initStreams = ({ stdin, stdout, stderr }) => {
	globalThis.process.stdout = module.exports.stdout = stdout;
	globalThis.process.stderr = module.exports.stderr = stderr;
	globalThis.process.stdin = module.exports.stdin = stdin;
};

function binding(name) {
	return globalThis.internalBinding(name);
}

module.exports = {
	pid: Math.round(Math.random() * 1000000),
	setTerminal,
	initStreams,
	argc: processController.argv().length,
	argv: processController.argv(),
	env: processController.getAllEnv(),
	nextTick,
	version,
	versions,
	execPath: processController.executablePath(),
	exit,
	features,
	abort,
	chdir,
	cwd,
	getuid,
	getgid,
	getgroups,
	umask,
	uptime,
	hrtime,
	memoryUsage,
	cpuUsage,
	binding,
	kill,
	on,
	once,
	off,
	addListener,
	removeListener,
	emit,
	emitWarning,
	getMaxListeners,
	setMaxListeners,
};
