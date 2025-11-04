/**
 * WordPress Blocks ESBuild Configuration
 * Replicates @wordpress/scripts build functionality
 */

const esbuild = require('esbuild-wasm');
const path = require('path');
const fs = require('fs');
const { readdirSync, statSync } = require('fs');
const crypto = require('crypto');
const postcss = require('postcss');
const sass = require('sass');
const autoprefixer = require('autoprefixer');
const rtlcss = require('rtlcss');
const cssnano = require('cssnano');
const postcssPresetEnv = require('postcss-preset-env');
const browserslist = require('browserslist');

// Production mode detection
const isProduction = process.env.NODE_ENV === 'production';
const mode = isProduction ? 'production' : 'development';
const outDir = '/build';
const srcDir = '/jsx/src';

// Get browserslist config
let browserTargets = browserslist();
if (!browserslist.findConfig('.')) {
	// Fallback to WordPress default browserslist
	browserTargets = browserslist('defaults, not ie 11');
}

/**
 * WordPress Dependency Extraction Plugin
 * Converts WordPress package imports to wp globals
 */
const wpDependencyExtractionPlugin = {
	name: 'wp-dependency-extraction',
	setup(build) {
		// Track dependencies for each entry point
		const entryDependencies = new Map();
		const entryAssets = new Map();

		// WordPress packages that should be externalized
		const wpPackages = [
			'a11y',
			'annotations',
			'api-fetch',
			'autop',
			'blob',
			'block-directory',
			'block-editor',
			'block-library',
			'block-serialization-default-parser',
			'blocks',
			'components',
			'compose',
			'core-data',
			'customize-widgets',
			'data',
			'data-controls',
			'date',
			'deprecated',
			'dom',
			'dom-ready',
			'edit-post',
			'edit-site',
			'edit-widgets',
			'editor',
			'element',
			'escape-html',
			'format-library',
			'hooks',
			'html-entities',
			'i18n',
			'is-shallow-equal',
			'keyboard-shortcuts',
			'keycodes',
			'list-reusable-blocks',
			'media-utils',
			'notices',
			'nux',
			'plugins',
			'preferences',
			'preferences-persistence',
			'primitives',
			'priority-queue',
			'redux-routine',
			'reusable-blocks',
			'rich-text',
			'server-side-render',
			'shortcode',
			'style-engine',
			'token-list',
			'url',
			'viewport',
			'warning',
			'widgets',
			'wordcount',
		];

		// Additional externals
		const additionalExternals = {
			jquery: 'jQuery',
			react: 'React',
			'react-dom': 'ReactDOM',
			lodash: 'lodash',
			'lodash-es': 'lodash',
			moment: 'moment',
		};

		build.onResolve({ filter: /^@wordpress\// }, (args) => {
			const packageName = args.path.replace('@wordpress/', '');
			if (wpPackages.includes(packageName)) {
				return {
					path: args.path,
					namespace: 'wp-external',
					pluginData: {
						importPath: args.path,
						globalName: `wp.${packageName.replace(
							/-([a-z])/g,
							(_, letter) => letter.toUpperCase()
						)}`,
						entryPoint: args.importer,
					},
				};
			}
		});

		build.onResolve(
			{ filter: /^(jquery|react|react-dom|lodash|lodash-es|moment)$/ },
			(args) => {
				return {
					path: args.path,
					namespace: 'wp-external',
					pluginData: {
						importPath: args.path,
						globalName: additionalExternals[args.path],
						entryPoint: args.importer,
					},
				};
			}
		);

		build.onLoad({ filter: /.*/, namespace: 'wp-external' }, (args) => {
			const globalName = args.pluginData.globalName;

			// Track dependency for asset file generation
			const entryPoint = args.pluginData.entryPoint;
			if (entryPoint && !entryDependencies.has(entryPoint)) {
				entryDependencies.set(entryPoint, new Set());
			}
			if (entryPoint) {
				entryDependencies
					.get(entryPoint)
					.add(args.pluginData.importPath);
			}

			// Generate proper CommonJS export that references the global
			// This works in IIFE format by directly referencing window
			const parts = globalName.split('.');
			let accessCode = 'window';
			for (const part of parts) {
				accessCode += `["${part}"]`;
			}

			return {
				contents: `
                    var obj = ${accessCode};
                    if (obj && obj.__esModule) {
                        module.exports = obj;
                    } else {
                        var wrapper = Object.assign({}, obj);
                        wrapper.default = obj;
                        module.exports = wrapper;
                    }
                `,
				loader: 'js',
			};
		});

		build.onEnd((result) => {
			// Generate asset files for each entry point by analyzing the metafile
			if (result.metafile) {
				const outputs = result.metafile.outputs;
				const inputs = result.metafile.inputs;
				let assetCount = 0;

				for (const [outputPath, outputInfo] of Object.entries(
					outputs
				)) {
					// Skip non-JS files and source maps
					if (
						!outputPath.endsWith('.js') ||
						outputPath.endsWith('.map')
					)
						continue;

					// Find the corresponding entry point
					const entryPoint = outputInfo.entryPoint;
					if (!entryPoint) continue;

					// Find all WordPress and other external dependencies
					const wpDeps = new Set();

					// Scan the inputs that are part of this bundle
					if (outputInfo.inputs) {
						for (const inputPath of Object.keys(
							outputInfo.inputs
						)) {
							// Check if this input is a WordPress external
							if (
								inputPath.startsWith('wp-external:@wordpress/')
							) {
								const pkg = inputPath.replace(
									'wp-external:@wordpress/',
									'wp-'
								);
								wpDeps.add(pkg);
							}
							// Check if this input is react
							else if (inputPath === 'wp-external:react') {
								wpDeps.add('react');
							}
							// Check if this input is react-dom
							else if (inputPath === 'wp-external:react-dom') {
								wpDeps.add('react-dom');
							}
							// Check other externals
							else if (inputPath.startsWith('wp-external:')) {
								const extName = inputPath.replace(
									'wp-external:',
									''
								);
								if (extName === 'jquery') wpDeps.add('jquery');
								else if (
									extName === 'lodash' ||
									extName === 'lodash-es'
								)
									wpDeps.add('lodash');
								else if (extName === 'moment')
									wpDeps.add('moment');
							}
						}
					}

					// Generate version hash from file content
					const fileContent = fs.readFileSync(outputPath, 'utf8');
					const hash = crypto
						.createHash('md5')
						.update(fileContent)
						.digest('hex')
						.substring(0, 8);

					const assetPath = outputPath.replace(/\.js$/, '.asset.php');

					// Format as WordPress expects: array('key' => 'value')
					const depsArray = Array.from(wpDeps)
						.sort()
						.map((dep) => `'${dep}'`)
						.join(', ');
					const assetContent = `<?php return array('dependencies' => array(${depsArray}), 'version' => '${hash}');`;

					fs.writeFileSync(assetPath, assetContent);
					assetCount++;
				}

				if (assetCount > 0) {
					console.log(
						`✓ Generated ${assetCount} asset manifest file(s)`
					);
				}
			}
		});
	},
};

/**
 * CSS/SCSS/PostCSS Processing Plugin
 */
const cssPlugin = {
	name: 'css-processor',
	setup(build) {
		// Handle CSS imports
		build.onLoad({ filter: /\.(css|pcss|scss|sass)$/ }, async (args) => {
			let css = fs.readFileSync(args.path, 'utf8');

			// Process SCSS/Sass
			if (args.path.endsWith('.scss') || args.path.endsWith('.sass')) {
				const result = sass.compile(args.path, {
					sourceMap: !isProduction,
					style: isProduction ? 'compressed' : 'expanded',
				});
				css = result.css;
			}

			// PostCSS processing
			const postcssPlugins = [
				autoprefixer(),
				postcssPresetEnv({
					stage: 0,
					// browsers: browserTargets
				}),
			];

			if (isProduction) {
				postcssPlugins.push(
					cssnano({
						preset: [
							'default',
							{
								discardComments: {
									removeAll: true,
								},
							},
						],
					})
				);
			}

			const processed = await postcss(postcssPlugins).process(css, {
				from: args.path,
				map: !isProduction,
			});

			// Generate RTL version
			const rtlResult = await postcss([rtlcss()]).process(processed.css, {
				from: args.path,
			});

			// Find which block this CSS belongs to
			let outputPath;
			if (args.path.startsWith(srcDir)) {
				const relativePath = path.relative(srcDir, args.path);

				// Check if this is inside a blocks directory
				if (relativePath.startsWith('blocks' + path.sep)) {
					// Extract block name: blocks/example-block/editor.scss -> blocks/example-block/
					const pathParts = relativePath.split(path.sep);
					if (pathParts.length >= 2) {
						const blockName = pathParts[1];
						const fileName = path
							.basename(args.path)
							.replace(/\.(scss|sass|pcss)$/, '.css');
						outputPath = path.join(
							outDir,
							'blocks',
							blockName,
							fileName
						);
					} else {
						outputPath = path.join(
							outDir,
							relativePath.replace(/\.(scss|sass|pcss)$/, '.css')
						);
					}
				} else {
					// Not in blocks directory, use relative path
					outputPath = path.join(
						outDir,
						relativePath.replace(/\.(scss|sass|pcss)$/, '.css')
					);
				}
			} else {
				const relativePath = path.relative(srcDir, args.path);
				outputPath = path.join(
					outDir,
					relativePath.replace(/\.(scss|sass|pcss)$/, '.css')
				);
			}

			const cssPath = outputPath;
			const rtlPath = cssPath.replace(/\.css$/, '-rtl.css');

			// Ensure directory exists
			fs.mkdirSync(path.dirname(cssPath), { recursive: true });

			// Write main CSS
			fs.writeFileSync(cssPath, processed.css);

			// Write RTL CSS
			fs.writeFileSync(rtlPath, rtlResult.css);

			// Return empty JS module
			return {
				contents: '',
				loader: 'js',
			};
		});
	},
};

/**
 * Block.json Processing Plugin
 */
const blockJsonPlugin = {
	name: 'block-json',
	setup(build) {
		build.onEnd(async () => {
			const blockJsonFiles = findFiles(srcDir, /^block\.json$/, 0, 10);

			let processedCount = 0;

			for (const file of blockJsonFiles) {
				const content = JSON.parse(fs.readFileSync(file, 'utf8'));

				// Get path relative to src directory
				const relativePath = path.relative(srcDir, file);
				const outputPath = path.join(outDir, relativePath);

				// Convert script/module paths
				const scriptFields = [
					'editorScript',
					'script',
					'viewScript',
					'editorScriptModule',
					'scriptModule',
					'viewScriptModule',
				];

				scriptFields.forEach((field) => {
					if (content[field]) {
						if (Array.isArray(content[field])) {
							content[field] = content[field].map((p) =>
								p.replace(/\.(ts|tsx|jsx)$/, '.js')
							);
						} else {
							content[field] = content[field].replace(
								/\.(ts|tsx|jsx)$/,
								'.js'
							);
						}
					}
				});

				// Ensure directory exists
				fs.mkdirSync(path.dirname(outputPath), { recursive: true });

				// Write transformed block.json
				fs.writeFileSync(outputPath, JSON.stringify(content, null, 2));
				processedCount++;
			}

			if (processedCount > 0) {
				console.log(`✓ Processed ${processedCount} block.json file(s)`);
			}
		});
	},
};

/**
 * PHP Files Copy Plugin
 * Copies PHP files from src/ to build/ (removing src/ prefix)
 */
const phpCopyPlugin = {
	name: 'php-copy',
	setup(build) {
		build.onEnd(async () => {
			// Only find PHP files in src directory
			const phpFiles = findFiles(srcDir, /\.php$/, 0, 10);

			for (const file of phpFiles) {
				// Get path relative to src directory, not project root
				const relativePath = path.relative(srcDir, file);
				const outputPath = path.join(outDir, relativePath);

				// Ensure directory exists
				fs.mkdirSync(path.dirname(outputPath), { recursive: true });

				// Copy PHP file
				fs.copyFileSync(file, outputPath);
			}

			if (phpFiles.length > 0) {
				console.log(`✓ Copied ${phpFiles.length} PHP file(s)`);
			}
		});
	},
};

/**
 * SVG React Component Plugin
 */
const svgPlugin = {
	name: 'svg-react',
	setup(build) {
		build.onLoad({ filter: /\.svg$/ }, async (args) => {
			const svg = fs.readFileSync(args.path, 'utf8');

			// Simple SVG to React component transformation
			const componentCode = `
                import React from 'react';
                export default function SvgComponent(props) {
                    return ${svg.replace(/class=/g, 'className=')};
                }
            `;

			return {
				contents: componentCode,
				loader: 'jsx',
			};
		});
	},
};

/**
 * Recursively find files in a directory
 */
function findFiles(dir, pattern, depth = 0, maxDepth = 3) {
	const results = [];

	if (depth > maxDepth) return results;

	try {
		const files = readdirSync(dir);

		for (const file of files) {
			const filePath = path.join(dir, file);
			const stat = statSync(filePath);

			if (stat.isDirectory()) {
				results.push(
					...findFiles(filePath, pattern, depth + 1, maxDepth)
				);
			} else if (
				pattern.test(file) &&
				!file.includes('.test.') &&
				!file.includes('.spec.')
			) {
				results.push(filePath);
			}
		}
	} catch (err) {
		// Directory doesn't exist or can't be read
	}

	return results;
}

/**
 * Find entry points - each block gets its own entry
 */
function getEntryPoints() {
	const entries = {};
	// Find all block.json files to identify block directories
	const blockJsonFiles = findFiles(srcDir, /^block\.json$/, 0, 10);

	console.log({ srcDir, blockJsonFiles });

	blockJsonFiles.forEach((blockJsonPath) => {
		const blockDir = path.dirname(blockJsonPath);
		const blockDirName = path.basename(blockDir);

		// Look for index.js/ts/jsx/tsx in this block directory
		const possibleEntries = [
			'index.js',
			'index.jsx',
			'index.ts',
			'index.tsx',
		];

		for (const entryFile of possibleEntries) {
			const entryPath = path.join(blockDir, entryFile);
			if (fs.existsSync(entryPath)) {
				const relativePath = path.relative(srcDir, entryPath);
				// Output to blocks/{blockname}/index.js
				entries[`blocks/${blockDirName}/index`] = relativePath;
				break;
			}
		}

		// Also look for view.js, editor.js, etc. in the same directory
		const additionalEntries = ['view', 'editor', 'script'];
		additionalEntries.forEach((entryType) => {
			for (const ext of ['.js', '.jsx', '.ts', '.tsx']) {
				const entryPath = path.join(blockDir, entryType + ext);
				if (fs.existsSync(entryPath)) {
					const relativePath = path.relative(srcDir, entryPath);
					entries[`blocks/${blockDirName}/${entryType}`] =
						relativePath;
					break;
				}
			}
		});
	});

	return entries;
}

/**
 * Main build function
 */
async function build() {
	const entries = getEntryPoints();

	if (Object.keys(entries).length === 0) {
		console.error('No entry points found!');
		process.exit(1);
	}

	console.log('Building with entries:', JSON.stringify(entries, null, 2));

	const buildOptions = {
		entryPoints: entries,
		bundle: true,
		// @TODO: When a relative path is used, different assets go to
		//        different roots, e.g. /build, /esbuild/build, /tmp/build, etc.
		outdir: outDir,
		format: 'iife',
		platform: 'browser',
		// target: browserTargets.map(b => b.replace(/\s+/g, '')),
		sourcemap: !isProduction,
		minify: isProduction,
		metafile: true,
		loader: {
			'.js': 'jsx',
			'.jsx': 'jsx',
			'.ts': 'tsx',
			'.tsx': 'tsx',
			'.json': 'json',
			'.png': 'file',
			'.jpg': 'file',
			'.jpeg': 'file',
			'.gif': 'file',
			'.webp': 'file',
			'.woff': 'file',
			'.woff2': 'file',
			'.eot': 'file',
			'.ttf': 'file',
			'.otf': 'file',
		},
		assetNames: 'assets/[name]-[hash]',
		define: {
			'process.env.NODE_ENV': JSON.stringify(mode),
			SCRIPT_DEBUG: JSON.stringify(!isProduction),
			'globalThis.SCRIPT_DEBUG': JSON.stringify(!isProduction),
		},
		plugins: [
			wpDependencyExtractionPlugin,
			cssPlugin,
			svgPlugin,
			blockJsonPlugin,
			phpCopyPlugin,
		],
		logLevel: 'info',
	};

	let buildFailed = false;
	try {
		// Clean build directory
		if (fs.existsSync(outDir)) {
			// fs.rmSync(outDir, { recursive: true, force: true });
		}

		const result = await esbuild.build(buildOptions);

		// Generate metafile for analysis if requested
		if (process.env.WP_BUNDLE_ANALYZER && result.metafile) {
			fs.writeFileSync(
				path.join(outDir, 'metafile.json'),
				JSON.stringify(result.metafile)
			);
			console.log(
				`Bundle analysis metafile generated at ${path.join(
					outDir,
					'metafile.json'
				)}`
			);
			console.log('View it at: https://esbuild.github.io/analyze/');
		}

		console.log('Build completed successfully!');
	} catch (error) {
		buildFailed = true;
		console.error('Build failed:', error);
		console.log(error.message);
		console.log(error.stack);
		process.exitCode = 1;
		return;
	} finally {
		try {
			await esbuild.stop();
			console.log('esbuild service stopped');
		} catch (stopError) {
			console.error(
				'esbuild.stop() failed:',
				stopError && stopError.stack ? stopError.stack : stopError
			);
			if (!buildFailed) {
				process.exitCode = process.exitCode ?? 1;
			}
		}
	}
}

// Run build
build();
