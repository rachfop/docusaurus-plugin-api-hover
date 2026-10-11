/**
 * Post-tsc build steps. tsc emits every module as CommonJS for Node (the
 * plugin entries, rehype pass, CLI); these steps fix up what runs
 * elsewhere.
 *
 *  - Strips comments from the CommonJS output. Docusaurus, Astro, and
 *    Blume load config files (and what they require) through jiti, which
 *    decides ESM vs CJS by regex over the raw source, comments included:
 *    prose such as a line ending in "import" followed by a JSDoc " * "
 *    reads as ESM, and a CJS `module.exports =` default then disappears.
 *    The .d.ts files keep the docs.
 *  - Bundles the Docusaurus client modules (theme components, runtime) as
 *    ES modules. Docusaurus runs its Babel preset over any path containing
 *    "docusaurus"; on CommonJS input it injects ESM helper imports, which
 *    turns the file into a broken hybrid. Theme packages ship ESM for this
 *    reason. Shared code lands in chunks so the runtime and the code
 *    block components share one copy of the engine.
 *  - Bundles the standalone browser script (lib/browser/quickinfo.js): one
 *    self-contained IIFE, styles inlined, for sites that load quickinfo
 *    with a plain <script> tag (Sphinx, MkDocs, anything static).
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const lib = path.join(root, 'lib');

function* jsFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

let stripped = 0;
for (const file of jsFiles(lib)) {
  const source = fs.readFileSync(file, 'utf8');
  const shebang = source.startsWith('#!') ? source.slice(0, source.indexOf('\n') + 1) : '';
  const { code } = esbuild.transformSync(source.slice(shebang.length), {
    format: 'cjs',
    loader: 'js',
    legalComments: 'none',
    target: 'es2019',
  });
  fs.writeFileSync(file, shebang + code);
  stripped++;
}
console.log(`bundle: stripped comments from ${stripped} CommonJS files`);

const docusaurusSrc = path.join(root, 'src', 'docusaurus');
esbuild.buildSync({
  entryPoints: [
    'theme/Root.tsx',
    'theme/CodeBlock/Line/index.tsx',
    'theme/CodeBlock/Line/Token/index.tsx',
    'runtime.tsx',
  ].map((entry) => path.join(docusaurusSrc, entry)),
  outbase: docusaurusSrc,
  outdir: path.join(lib, 'docusaurus'),
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2019',
  jsx: 'automatic',
  legalComments: 'none',
  external: [
    'react',
    'react/*',
    'react-dom',
    'clsx',
    '@docusaurus/*',
    '@theme-init/*',
    'quickinfo/data',
    'quickinfo/config',
    'quickinfo/styles',
  ],
  logLevel: 'warning',
});
// Bundled into the client modules above; the CommonJS copy has no caller.
fs.rmSync(path.join(lib, 'docusaurus', 'site-data.js'), { force: true });
console.log('bundle: src/docusaurus client modules -> lib/docusaurus (ESM)');

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'browser', 'standalone.ts')],
  outfile: path.join(lib, 'browser', 'quickinfo.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2019',
  minify: true,
  legalComments: 'none',
  loader: { '.css': 'text' },
  logLevel: 'warning',
});
// tsc's CommonJS copy of the entry imports a stylesheet Node can't load.
fs.rmSync(path.join(lib, 'browser', 'standalone.js'), { force: true });
console.log('bundle: src/browser/standalone.ts -> lib/browser/quickinfo.js');
