export async function initFiles(fs) {
	fs.mkdirSync('/home/user/.npm/_cacache', { recursive: true })
	if (!fs.existsSync('/.npm')) {
		fs.mkdirSync('/.npm')
	}
	fs.mkdirSync('/bin', { recursive: true })
	fs.mkdirSync('/tmp', { recursive: true })
	if (!fs.existsSync('/bin/node')) {
		fs.writeFileSync('/bin/node', '', { mode: 0o755 })
	}

	// Set up NPM
	if (!fs.existsSync('/bin/npm')) {
		const npmCodeResponse = await fetch('/npm/npm-single.js')
		const npmCode = await npmCodeResponse.text()
		fs.writeFileSync('/bin/npm', npmCode, { mode: 0o755 })
	}
	if (!fs.existsSync('/bin/default-input.js')) {
		const defaultInputResponse = await fetch('/npm/default-input.js')
		const defaultInputCode = await defaultInputResponse.text()
		fs.writeFileSync('/bin/default-input.js', defaultInputCode)
	}

	// Set up demo projects
	fs.mkdirSync('/demos', { recursive: true })
	if (!fs.existsSync('/demos/hello.js')) {
		fs.writeFileSync('/demos/hello.js', "console.log('Hello, world!');\n")
	}

	fs.writeFileSync(
		'/demos/package.json',
		JSON.stringify(
			{
				name: '@wordpress/scripts',
				version: '30.25.0',
				description:
					'Collection of reusable scripts for WordPress development.',
				author: 'The WordPress Contributors',
				license: 'GPL-2.0-or-later',
				keywords: ['wordpress', 'gutenberg', 'scripts'],
				homepage:
					'https://github.com/WordPress/gutenberg/tree/HEAD/packages/scripts/README.md',
				repository: {
					type: 'git',
					url: 'https://github.com/WordPress/gutenberg.git',
					directory: 'packages/scripts',
				},
				bugs: {
					url: 'https://github.com/WordPress/gutenberg/issues',
				},
				engines: {
					node: '>=18.12.0',
					npm: '>=8.19.2',
				},
				files: ['bin', 'config', 'plugins', 'scripts', 'utils'],
				bin: {
					'wp-scripts': './bin/wp-scripts.js',
				},
				dependencies: {
					'@babel/core': '7.25.7',
					'@pmmmwh/react-refresh-webpack-plugin': '^0.5.11',
					'@svgr/webpack': '^8.0.1',
					'@wordpress/babel-preset-default': '^8.32.0',
					'@wordpress/browserslist-config': '^6.32.0',
					'@wordpress/dependency-extraction-webpack-plugin':
						'^6.32.0',
					'@wordpress/eslint-plugin': '^22.18.0',
					'@wordpress/npm-package-json-lint-config': '^5.32.0',
					'@wordpress/postcss-plugins-preset': '^5.32.0',
					'@wordpress/prettier-config': '^4.32.0',
					'@wordpress/stylelint-config': '^23.24.0',
					'adm-zip': '^0.5.9',
					'babel-loader': '9.2.1',
					browserslist: '^4.21.10',
					chalk: '^4.0.0',
					'check-node-version': '^4.1.0',
					'copy-webpack-plugin': '^10.2.0',
					'cross-spawn': '^7.0.6',
					'css-loader': '^6.2.0',
					cssnano: '^6.0.1',
					cwd: '^0.10.0',
					'dir-glob': '^3.0.1',
					eslint: '^8.3.0',
					'fast-glob': '^3.2.7',
					filenamify: '^4.2.0',
					json2php: '^0.0.9',
					'merge-deep': '^3.0.3',
					'mini-css-extract-plugin': '^2.9.2',
					minimist: '^1.2.0',
					'npm-package-json-lint': '^6.4.0',
					'npm-packlist': '^3.0.0',
					postcss: '^8.4.5',
					'postcss-loader': '^6.2.1',
					prettier: 'npm:wp-prettier@3.0.3',
					'react-refresh': '^0.14.0',
					'read-pkg-up': '^7.0.1',
					'resolve-bin': '^0.4.0',
					rtlcss: '^4.3.0',
					sass: '^1.54.0',
					'sass-loader': '^16.0.3',
					'schema-utils': '^4.2.0',
					'source-map-loader': '^3.0.0',
					stylelint: '^16.8.2',
					'terser-webpack-plugin': '^5.3.10',
					'url-loader': '^4.1.1',
					webpack: '^5.97.0',
					'webpack-bundle-analyzer': '^4.9.1',
					'webpack-cli': '^5.1.4',
					'webpack-dev-server': '^4.15.1',
				},
				peerDependenciesMeta: {
					'@wordpress/env': {
						optional: true,
					},
				},
				publishConfig: {
					access: 'public',
				},
				gitHead: 'a030b4c0e0695239b942c7dc18511782b64f10ed',
			},
			null,
			2
		)
	)

	fs.mkdirSync('/demos/demo-ts', { recursive: true })
	const packageJsonPath = '/demos/demo-ts/package.json'
	const requiredDependencies = {
		webpack: '*',
		'webpack-cli': '*',
		'function-bind': '*',
		'ts-loader': '*',
		typescript: '*',
		react: '*',
		'react-dom': '*',
		'@types/react': '*',
		'@types/react-dom': '*',
		'@types/node': '*',
	}
	let packageJson = {
		name: 'web-polyfills-app',
		version: '1.0.0',
		private: true,
		dependencies: {},
	}
	if (fs.existsSync(packageJsonPath)) {
		try {
			const existing = JSON.parse(
				fs.readFileSync(packageJsonPath, 'utf8')
			)
			if (existing && typeof existing === 'object') {
				packageJson = {
					...packageJson,
					...existing,
					dependencies: { ...existing.dependencies },
				}
			}
		} catch (error) {
			console.warn(
				'Failed to parse existing package.json, recreating it.',
				error
			)
		}
	}
	if (
		!packageJson.dependencies ||
		typeof packageJson.dependencies !== 'object'
	) {
		packageJson.dependencies = {}
	}
	for (const [dep, version] of Object.entries(requiredDependencies)) {
		if (!(dep in packageJson.dependencies)) {
			packageJson.dependencies[dep] = version
		}
	}
	fs.writeFileSync(
		packageJsonPath,
		`${JSON.stringify(packageJson, null, 2)}\n`
	)

	const webpackConfigPath = '/demos/demo-ts/webpack.config.js'
	const webpackConfigContent = `module.exports = {
entry: '/demos/demo-ts/typescript-react.tsx',
output: {
filename: 'bundle.js',
},
module: {
rules: [
{
	test: /\\.tsx?$/,
	use: 'ts-loader',
	exclude: /node_modules/,
},
],
},
resolve: {
extensions: ['.tsx', '.ts', '.js'],
}
};
`
	let existingWebpackConfig = null
	if (fs.existsSync(webpackConfigPath)) {
		existingWebpackConfig = fs.readFileSync(webpackConfigPath, 'utf8')
	}
	if (existingWebpackConfig !== webpackConfigContent) {
		fs.writeFileSync(webpackConfigPath, webpackConfigContent)
	}
	const tsconfigPath = '/demos/demo-ts/tsconfig.json'
	const tsconfigObject = {
		compilerOptions: {
			target: 'ES2018',
			module: 'ESNext',
			moduleResolution: 'Node',
			jsx: 'react',
			esModuleInterop: true,
			allowSyntheticDefaultImports: true,
			skipLibCheck: true,
			forceConsistentCasingInFileNames: true,
			isolatedModules: true,
			lib: ['DOM', 'DOM.Iterable', 'ESNext'],
			types: ['node', 'react', 'react-dom'],
		},
		include: ['./**/*.ts', './**/*.tsx'],
	}
	const tsconfigContent = `${JSON.stringify(tsconfigObject, null, 2)}\n`
	if (
		!fs.existsSync(tsconfigPath) ||
		fs.readFileSync(tsconfigPath, 'utf8') !== tsconfigContent
	) {
		fs.writeFileSync(tsconfigPath, tsconfigContent)
	}

	if (!fs.existsSync('/demos/demo-ts/typescript-react.tsx')) {
		fs.writeFileSync(
			'/demos/demo-ts/typescript-react.tsx',
			`
	const React = require('react');
	const ReactDOM = require('react-dom');
	ReactDOM.render(<h1>Hello, world!</h1>, document.getElementById('root'));
	`
		)
	}

	fs.mkdirSync('/bin', { recursive: true })
	fs.mkdirSync('/demos/demo-worker', { recursive: true })
	fs.writeFileSync(
		'/demos/demo-worker/demo.js',
		`
const { spawn } = require('child_process');
console.log("Started demo.");
const childProcess = spawn('node', ['/demos/demo-worker/child.js']);
console.log("spawned child process.");
childProcess.on('exit', (code, signal) => {
	console.log("Child process exited with code", code, "and signal", signal);
});
`
	)
	fs.writeFileSync(
		'/demos/demo-worker/child.js',
		`
		console.log("[CHILD] Child process spawned");
		const fs = require('fs');
		console.log("required fs");
		console.log('CHILD', fs.readdirSync('/'));
		`
	)

	fs.mkdirSync('/demos/demo-cowsay', { recursive: true })
	if (!fs.existsSync('/demos/demo-cowsay/package.json')) {
		fs.writeFileSync(
			'/demos/demo-cowsay/package.json',
			JSON.stringify(
				{
					name: 'cowsay',
					version: '1.0.0',
					private: true,
					dependencies: {
						cowsay: '*',
					},
				},
				null,
				2
			)
		)
		fs.writeFileSync(
			'/demos/demo-cowsay/test.js',
			`const cowsay = require('cowsay');
		console.log(cowsay.say({
			text : "I'm a moooodule",
			e : "oO",
			T : "U "
		}));
`
		)
	}

	// npm really wants to see a module called `node-gyp` in the filesystem,
	// even if it doesn't actually run it.
	fs.mkdirSync('/node_modules/node-gyp/bin', {
		recursive: true,
	})
	fs.writeFileSync('/node_modules/node-gyp/package.json', '{}')
	fs.writeFileSync('/node_modules/node-gyp/bin/node-gyp.js', '')
}
