import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../../runtime/index.ts';
import { installCustomPrograms } from '../programs/index.ts';
import { ensureEsbuildDependencyStubs } from '../shared/esbuild-dependency-stubs.ts';

const createStubModule = `
(async () => {
  try {
    const sass = require('sass');
    if (!sass || typeof sass !== 'object') {
      throw new Error('Missing sass export');
    }
    if (typeof sass.renderSync !== 'function') {
      throw new Error('Sass stub missing renderSync');
    }
    if (typeof sass.compile !== 'function') {
      throw new Error('Sass stub missing compile');
    }
    process.stderr.write('sass stub loaded\\n');
    const compileResult = sass.compile('input.scss', {});
    if (!compileResult || typeof compileResult.css !== 'string') {
      throw new Error('Sass compile returned invalid result');
    }
    process.stderr.write('sass.compile ok\\n');

    const postcss = require('postcss');
    if (typeof postcss !== 'function') {
      throw new Error('PostCSS stub is not callable');
    }
    const processor = postcss([]);
    const processed = await processor.process('body { color: red; }', { map: true });
    if (!processed || typeof processed.css !== 'string') {
      throw new Error('PostCSS process returned invalid result');
    }
    process.stderr.write('postcss.process ok\\n');

    const autoprefixer = require('autoprefixer');
    if (typeof autoprefixer !== 'function') {
      throw new Error('autoprefixer stub is not callable');
    }
    const autoprefixerPlugin = autoprefixer();
    if (!autoprefixerPlugin || typeof autoprefixerPlugin !== 'object') {
      throw new Error('autoprefixer did not return a plugin object');
    }
    process.stderr.write('autoprefixer ok\\n');

    const browserslist = require('browserslist');
    if (typeof browserslist !== 'function') {
      throw new Error('browserslist stub is not callable');
    }
    const targets = browserslist();
    if (!Array.isArray(targets)) {
      throw new Error('browserslist did not return an array');
    }
    process.stderr.write('browserslist ok\\n');

    process.exit(0);
  } catch (error) {
    console.error('stub test error', error && error.stack ? error.stack : error);
    process.exit(1);
  }
})();
`;

describe('esbuild dependency stubs', () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = new Kernel();
    installCustomPrograms(kernel);
    ensureEsbuildDependencyStubs(kernel);
  });

  it('loads sass stub from /esbuild/node_modules', async () => {
    kernel.writeFileSync('/esbuild/test-stub.js', createStubModule, 'utf8');

    const subprocess = kernel.spawn({
      argv: ['node', '/esbuild/test-stub.js'],
      env: {
        PATH: '/bin',
        NODE_PATH: '/esbuild/node_modules',
      },
      cwd: '/esbuild',
      name: 'dependency-stub-test',
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    });

    if (typeof subprocess === 'number') {
      throw new Error('Failed to spawn subprocess');
    }

    let stderr = '';
    let stdout = '';
    subprocess.stdout?.on('data', (chunk) => {
      const text =
        typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      stdout += text;
    });

    subprocess.stderr?.on('data', (chunk) => {
      const text =
        typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      stderr += text;
    });

    const exitCode = await new Promise<number>((resolve) => {
      subprocess.onExit((code) => resolve(code ?? 0));
    });

    if (exitCode !== 0) {
      console.error('[dependency-stub stdout]', stdout);
      console.error('[dependency-stub stderr]', stderr);
    }

    expect(exitCode).toBe(0);
  });
});
