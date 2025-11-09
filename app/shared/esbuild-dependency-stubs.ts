export const ESBUILD_DEPENDENCY_STUBS = [
	'postcss',
	'sass',
	'autoprefixer',
	'rtlcss',
	'cssnano',
	'postcss-preset-env',
	'browserslist',
] as const;

type KernelLike = {
	mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
	existsSync: (path: string) => boolean;
	writeFileSync: (
		path: string,
		data: string | Uint8Array,
		encoding?: 'utf8' | null
	) => void;
};

const STUB_SOURCES: Record<string, string> = {
	postcss: `const postcss = (plugins = []) => ({
  plugins: Array.isArray(plugins) ? [...plugins] : [],
  process(css, options = {}) {
    const output = typeof css === 'string' ? css : '';
    const mapEnabled = options && typeof options === 'object' && options.map
      ? { toString: () => '' }
      : null;
    return Promise.resolve({
      css: output,
      map: mapEnabled,
      warnings: () => [],
    });
  },
});
postcss.plugin = function plugin(_name, initializer) {
  return function (...args) {
    return typeof initializer === 'function' ? initializer(...args) : () => {};
  };
};
module.exports = postcss;
module.exports.default = postcss;
`,
	sass: `const createResult = (css = '') => ({
  css,
  loadedUrls: [],
  sourceMap: null,
  stats: {},
});
const sass = {
  render(options = {}, callback) {
    const data =
      typeof options === 'object' && options !== null && typeof options.data === 'string'
        ? options.data
        : '';
    const result = createResult(data);
    if (typeof callback === 'function') {
      callback(null, result);
      return;
    }
    return Promise.resolve(result);
  },
  renderSync(options = {}) {
    const data =
      typeof options === 'object' && options !== null && typeof options.data === 'string'
        ? options.data
        : '';
    return createResult(data);
  },
  compile(_path, _options = {}) {
    return createResult('');
  },
  compileString(source = '', _options = {}) {
    return createResult(typeof source === 'string' ? source : '');
  },
  info: 'stub-sass',
  types: {},
};
module.exports = sass;
module.exports.default = sass;
`,
	browserslist: `function browserslist() {
  return ['defaults'];
}
browserslist.findConfig = () => null;
browserslist.loadConfig = () => null;
browserslist.default = browserslist;
module.exports = browserslist;
module.exports.default = browserslist;
`,
};

export function getEsbuildStubSource(name: string): string {
	if (Object.prototype.hasOwnProperty.call(STUB_SOURCES, name)) {
		return STUB_SOURCES[name];
	}
	const safeIdentifier = name.replace(/[^A-Za-z0-9_$]/g, '_') || 'stub';
	return `function ${safeIdentifier}() {
  return {
    postcssPlugin: ${JSON.stringify(name)},
    Once() {},
  };
}
${safeIdentifier}.postcss = true;
module.exports = ${safeIdentifier};
module.exports.default = ${safeIdentifier};
`;
}

export function ensureEsbuildDependencyStubs(targetKernel: KernelLike): void {
	targetKernel.mkdirSync('/esbuild/node_modules', { recursive: true });
	for (const name of ESBUILD_DEPENDENCY_STUBS) {
		const dir = `/esbuild/node_modules/${name}`;
		targetKernel.mkdirSync(dir, { recursive: true });
		const packagePath = `${dir}/package.json`;
		if (!targetKernel.existsSync(packagePath)) {
			targetKernel.writeFileSync(
				packagePath,
				JSON.stringify(
					{ name, version: '0.0.0', main: 'index.js' },
					null,
					2
				),
				'utf8'
			);
		}
		const indexPath = `${dir}/index.js`;
		if (!targetKernel.existsSync(indexPath)) {
			const stubSource = getEsbuildStubSource(name);
			targetKernel.writeFileSync(indexPath, stubSource, 'utf8');
		}
	}
}

