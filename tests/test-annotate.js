/**
 * Tests for the resolution engine, the rehype pass, the Docusaurus plugin,
 * and the CLI. Plain Node: no build tools, requires the compiled lib/.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildIndex,
  resolveApiName,
  resolveMember,
  annotateLines,
  isAnnotatedLanguage,
  packNames,
  unpackNames,
  resolveHref,
  resolveProseMention,
} = require('../lib/index');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

const IDS = [
  'pathlib.Path',
  'pathlib.Path.cwd',
  'pathlib.PurePath',
  'pathlib.PurePath.name',
  'json.dumps',
  'json.loads',
  'collections.OrderedDict',
  'collections.abc.Sequence',
  'unittest.mock.MagicMock',
  'unittest.mock.patch',
  'unittest.mock.MagicMock.assert_called_once_with',
];
const BASES = { 'pathlib.Path': ['pathlib.PurePath'] };
const PREFER = ['mypkg.'];

function makeIndex() {
  return buildIndex(IDS, BASES, PREFER);
}

// --- resolveApiName -------------------------------------------------------

check('exact id resolves to itself', () => {
  assert.strictEqual(resolveApiName('pathlib.Path', {}, makeIndex()), 'pathlib.Path');
});

check('import alias resolves bare name', () => {
  assert.strictEqual(resolveApiName('dumps', { j: 'json' }, makeIndex()), 'json.dumps');
});

check('alias resolves dotted member chain', () => {
  assert.strictEqual(
    resolveApiName(
      'mock.MagicMock.assert_called_once_with',
      { mock: 'unittest.mock' },
      makeIndex(),
    ),
    'unittest.mock.MagicMock.assert_called_once_with',
  );
});

check('globally unique short name resolves', () => {
  assert.strictEqual(resolveApiName('OrderedDict', {}, makeIndex()), 'collections.OrderedDict');
});

check('ambiguous short name stays cold', () => {
  // "value" is documented on two unrelated classes; the short name
  // alone cannot pick one, so it stays cold.
  const ids = ['pkg.Foo.value', 'other.Bar.value'];
  const index = buildIndex(ids, {}, []);
  assert.strictEqual(resolveApiName('value', {}, index), undefined);
});

check('preferPrefixes breaks short-name collisions', () => {
  const ids = ['queue.Queue', 'multiprocessing.Queue'];
  const index = buildIndex(ids, {}, ['queue.']);
  assert.strictEqual(resolveApiName('Queue', {}, index), 'queue.Queue');
});

check('unresolvable name stays cold', () => {
  assert.strictEqual(resolveApiName('NotASymbol', {}, makeIndex()), undefined);
});

// --- inherited members ------------------------------------------------------

check('inherited member resolves through bases', () => {
  const index = makeIndex();
  assert.strictEqual(resolveMember(index, 'pathlib.Path', 'name'), 'pathlib.PurePath.name');
});

check('own member wins over inherited', () => {
  const index = buildIndex(
    [
      'unittest.mock.MagicMock.assert_called_once_with',
      'unittest.mock.MagicMock',
      'unittest.mock.NonCallableMock.assert_called_once_with',
      'unittest.mock.NonCallableMock',
    ],
    { 'unittest.mock.MagicMock': ['unittest.mock.NonCallableMock'] },
    [],
  );
  assert.strictEqual(
    resolveMember(index, 'unittest.mock.MagicMock', 'assert_called_once_with'),
    'unittest.mock.MagicMock.assert_called_once_with',
  );
});

check('undocumented member stays cold', () => {
  assert.strictEqual(resolveMember(makeIndex(), 'pathlib.Path', 'nope'), undefined);
});

// --- language gating --------------------------------------------------------

check('python language variants are annotated', () => {
  assert.ok(isAnnotatedLanguage('python'));
  assert.ok(isAnnotatedLanguage('py'));
  assert.ok(isAnnotatedLanguage('python3'));
});

check('non-python languages are skipped', () => {
  assert.strictEqual(isAnnotatedLanguage('rust'), false);
  assert.strictEqual(isAnnotatedLanguage('bash'), false);
  assert.strictEqual(isAnnotatedLanguage(undefined), false);
});

// --- annotateLines ----------------------------------------------------------

const index = makeIndex();

function annotate(code, line) {
  return annotateLines(line, code, 'python', index);
}

function flatLine(text) {
  // One plain token: exercises the identifier-splitting path.
  return [{ types: 'plain', content: text }];
}

function apiIds(tokens) {
  return tokens.filter((t) => t.apiId).map((t) => `${t.content}:${t.apiId}`);
}

check('bare token in plain text gets split and annotated', () => {
  const code = 'import json\n';
  const out = annotate(code, flatLine('dumps'));
  assert.deepStrictEqual(apiIds(out), ['dumps:json.dumps']);
});

check('dotted chain annotates each resolvable segment', () => {
  const code = 'from unittest import mock\n';
  const out = annotate(code, flatLine('mock.MagicMock'));
  // The alias segment itself stays cold (`unittest.mock` is not an indexed
  // symbol); the class segment resolves through the alias.
  assert.deepStrictEqual(apiIds(out), ['MagicMock:unittest.mock.MagicMock']);
});

check('undotted identifier inside operators is annotated', () => {
  const code = 'import json as j\nj.dumps({"ok": True})\n';
  const out = annotate(code, flatLine('j.dumps({"ok": True})'));
  // `j` alone is not an id (modules aren't indexed in this
  // fixture), but dumps resolves through the alias.
  assert.deepStrictEqual(apiIds(out), ['dumps:json.dumps']);
});

check('with-as binds annotate the bound name', () => {
  const code = 'from unittest import mock as mk\n';
  const out = annotate(code, flatLine('mk.MagicMock'));
  assert.deepStrictEqual(apiIds(out), ['MagicMock:unittest.mock.MagicMock']);
});

check('inferred local type annotates attribute access', () => {
  const code = 'from pathlib import Path\nconfig = Path("app.toml")\n';
  const out = annotate(code, flatLine('config.name'));
  // The local variable itself stays cold; the attribute resolves to the
  // member inherited from the documented base class.
  assert.deepStrictEqual(apiIds(out), ['name:pathlib.PurePath.name']);
});

check('non-python lines pass through untouched', () => {
  const line = [{ types: 'plain', content: 'dumps' }];
  assert.strictEqual(annotateLines(line, 'x', 'rust', index), line);
});

check('input line is never mutated', () => {
  const line = flatLine('dumps');
  annotate('import json\n', line);
  assert.strictEqual(line[0].apiId, undefined);
  assert.strictEqual(line.length, 1);
});

// --- python binding parsers -------------------------------------------------

const { parsePythonImports, parsePythonLocals, parsePythonBinds } = require('../lib/lib/python');

const resolvePath = (name) => (name === 'Path' ? 'pathlib.Path' : undefined);

check('parenthesized imports on one line resolve', () => {
  assert.deepStrictEqual(parsePythonImports('from unittest.mock import (MagicMock, patch)'), {
    MagicMock: 'unittest.mock.MagicMock',
    patch: 'unittest.mock.patch',
  });
});

check('parenthesized imports across lines resolve', () => {
  const code = 'from unittest.mock import (\n    MagicMock,  # the double\n    patch as p,\n)';
  assert.deepStrictEqual(parsePythonImports(code), {
    MagicMock: 'unittest.mock.MagicMock',
    p: 'unittest.mock.patch',
  });
});

check('brackets inside strings and comments leave line joining alone', () => {
  const code = 'print("(")  # )(\nfrom pathlib import Path';
  assert.deepStrictEqual(parsePythonImports(code), { Path: 'pathlib.Path' });
});

check('imports inside a docstring are ignored', () => {
  assert.deepStrictEqual(parsePythonImports('"""\nfrom pathlib import Path\n"""'), {});
});

check('typed assignment and multi-line with infer local types', () => {
  const code = 'p: Path = Path("a")\nwith Path(\n    "b",\n) as cfg:\n    pass';
  assert.deepStrictEqual(
    parsePythonLocals(code, { Path: 'pathlib.Path' }, resolvePath, new Set()),
    { p: 'pathlib.Path', cfg: 'pathlib.Path' },
  );
});

check('multi-line and async defs bind their parameters', () => {
  const code = 'async def run(\n    cfg,\n    *args,\n    x: int = 1,\n):\n    pass';
  assert.deepStrictEqual([...parsePythonBinds(code)].sort(), ['args', 'cfg', 'x']);
});

check('keyword arguments in a multi-line call are not binds', () => {
  assert.deepStrictEqual([...parsePythonBinds('run(\n    graph=1,\n)')], []);
});

// --- rehype plugin ----------------------------------------------------------

const rehype = require('../lib/rehype');

function tempDataFile(payload) {
  const file = path.join(
    os.tmpdir(),
    `quickinfo-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

function el(tagName, children, properties) {
  return { type: 'element', tagName, properties, children };
}

function text(value) {
  return { type: 'text', value };
}

function collectApiIds(tree) {
  const found = [];
  const walk = (node) => {
    if (node.properties && node.properties.dataApiId) {
      found.push(`${plainText(node)}=>${node.properties.dataApiId}`);
    }
    (node.children || []).forEach(walk);
  };
  walk(tree);
  return found;
}

function plainText(node) {
  if (node.type === 'text') return node.value;
  return (node.children || []).map(plainText).join('');
}

check('rehype annotates inline code mentions of indexed symbols', () => {
  const dataFile = tempDataFile({ ids: IDS });
  const transform = rehype({ dataFile, preferPrefixes: PREFER });
  const tree = el('root', [el('p', [el('code', [text('OrderedDict')])])]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), ['OrderedDict=>collections.OrderedDict']);
});

check('rehype skips code inside pre blocks', () => {
  const dataFile = tempDataFile({ ids: IDS });
  const transform = rehype({ dataFile, preferPrefixes: PREFER });
  const tree = el('root', [el('pre', [el('code', [text('OrderedDict')])])]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), []);
});

check('rehype link href is authoritative for the id', () => {
  const dataFile = tempDataFile({ ids: IDS });
  const transform = rehype({ dataFile, preferPrefixes: PREFER });
  const tree = el('root', [
    el('p', [
      el('a', [el('code', [text('Path')])], {
        href: '/api/generated/pathlib.Path.md',
      }),
    ]),
  ]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), ['Path=>pathlib.Path']);
});

check('rehype stays cold on ambiguous prose mention', () => {
  const dataFile = tempDataFile({
    ids: ['queue.Queue', 'multiprocessing.Queue'],
  });
  const transform = rehype({ dataFile });
  const tree = el('root', [el('p', [el('code', [text('Queue')])])]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), []);
});

check('rehype resolves a unique dotted suffix', () => {
  const dataFile = tempDataFile({ ids: IDS });
  const transform = rehype({ dataFile });
  const tree = el('root', [el('p', [el('code', [text('mock.patch()')])])]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), ['mock.patch()=>unittest.mock.patch']);
});

check('rehype with missing data file annotates nothing', () => {
  const transform = rehype({ dataFile: '/nonexistent/nope.json' });
  const tree = el('root', [el('p', [el('code', [text('OrderedDict')])])]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), []);
});

check('rehype rejects non-object options', () => {
  assert.throws(() => rehype('names.json'), /options must be an object/);
});

check('rehype rejects unknown languages', () => {
  assert.throws(() => rehype({ languages: ['rust'] }), /unknown languages/);
});

// --- review fixes -----------------------------------------------------------

check('malformed escapes in hrefs never throw', () => {
  const index = makeIndex();
  assert.strictEqual(resolveHref('#a%zz', index), undefined);
  assert.strictEqual(resolveHref('menu.html#50%', index), undefined);
});

check('links to other hosts never resolve, even when the fragment is an id', () => {
  const index = buildIndex(['int', 'pathlib.Path'], {}, []);
  assert.strictEqual(
    resolveHref('https://docs.python.org/3/library/stdtypes.html#int', index),
    undefined,
  );
  assert.strictEqual(resolveHref('//cdn.example/x#pathlib.Path', index), undefined);
  assert.strictEqual(resolveHref('/api/x#pathlib.Path', index), 'pathlib.Path');
});

check('preferPrefixes beats a bare id that is itself indexed', () => {
  const index = buildIndex(['type', 'mypkg.Config.type', 'bool', 'mypkg.DType.bool'], {}, [
    'mypkg.',
  ]);
  assert.strictEqual(resolveProseMention('bool', index), 'mypkg.DType.bool');
  assert.strictEqual(resolveApiName('type', {}, index), 'mypkg.Config.type');
  // Without a preferred id, the bare one still resolves.
  assert.strictEqual(resolveProseMention('bool', buildIndex(['bool'], {}, ['mypkg.'])), 'bool');
});

check('untyped languages skip names inside strings and comments', () => {
  const code = '>>> import json as j\n>>> j.dumps({})  # j.dumps here\n';
  const line = [{ types: 'plain', content: '>>> j.dumps({})  # dumps and "dumps" here' }];
  const out = annotateLines(line, code, 'pycon', makeIndex(), ['python']);
  assert.deepStrictEqual(apiIds(out), ['dumps:json.dumps']);
});

check('an unclosed bracket ends at the next column-0 statement', () => {
  const code = 'run(\n    a,\nfrom pathlib import Path\ncfg = Path("x")';
  assert.deepStrictEqual(parsePythonImports(code), { Path: 'pathlib.Path' });
});

check('rehype leaves inline code in links to other sites unresolved', () => {
  const dataFile = tempDataFile({ ids: IDS });
  const transform = rehype({ dataFile });
  const tree = el('root', [
    el('p', [
      el('a', [el('code', [text('OrderedDict')])], {
        href: 'https://example.com/py/#ordereddict',
      }),
    ]),
  ]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), []);
});

check('rehype resolves inline code in same-site links by name', () => {
  const dataFile = tempDataFile({ ids: IDS });
  const transform = rehype({ dataFile });
  // A heading anchor on the reference page names no symbol id.
  const tree = el('root', [
    el('p', [el('a', [el('code', [text('OrderedDict')])], { href: '/api-reference#options' })]),
  ]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), ['OrderedDict=>collections.OrderedDict']);
});

check('a plain path segment is a page, not a symbol', () => {
  const index = buildIndex(['quickinfo', 'pathlib.Path'], {}, []);
  assert.strictEqual(resolveHref('/quickinfo/', index), undefined);
  assert.strictEqual(resolveHref('/api/pathlib.Path/', index), 'pathlib.Path');
  assert.strictEqual(resolveHref('quickinfo.md', index), 'quickinfo');
});

check('rehype skips excluded pages', () => {
  const dataFile = tempDataFile({ ids: IDS });
  const transform = rehype({ dataFile, exclude: ['/api/rust/'] });
  const rust = el('root', [el('p', [el('code', [text('OrderedDict')])])]);
  transform(rust, { path: '/site/docs/api/rust/guide.md' });
  assert.deepStrictEqual(collectApiIds(rust), []);
  const python = el('root', [el('p', [el('code', [text('OrderedDict')])])]);
  transform(python, { path: '/site/docs/develop/guide.md' });
  assert.deepStrictEqual(collectApiIds(python), ['OrderedDict=>collections.OrderedDict']);
});

check('rehype resolves a relative dataFile against the site directory', () => {
  const siteDir = tempSite();
  fs.writeFileSync(path.join(siteDir, 'docusaurus.config.js'), 'module.exports = {};');
  fs.mkdirSync(path.join(siteDir, 'static', 'quickinfo'), { recursive: true });
  fs.writeFileSync(
    path.join(siteDir, 'static', 'quickinfo', 'names.json'),
    JSON.stringify({ ids: IDS }),
  );
  fs.mkdirSync(path.join(siteDir, 'docs'));
  const transform = rehype();
  const tree = el('root', [el('p', [el('code', [text('OrderedDict')])])]);
  // process.cwd() is the repo, not the site.
  transform(tree, { path: path.join(siteDir, 'docs', 'page.md') });
  assert.deepStrictEqual(collectApiIds(tree), ['OrderedDict=>collections.OrderedDict']);
});

// --- docusaurus plugin ------------------------------------------------------

const docusaurus = require('../lib/docusaurus');

function tempSite() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'quickinfo-site-'));
}

check('validateOptions fills every default', () => {
  assert.deepStrictEqual(docusaurus.validateOptions({ options: undefined }), {
    dataFile: 'static/quickinfo/names.json',
    infoUrl: '/quickinfo/info.json',
    preferPrefixes: [],
    languages: ['python'],
    exclude: [],
  });
});

check('validateOptions rejects malformed options', () => {
  assert.throws(() => docusaurus.validateOptions({ options: { infoUrl: 3 } }), /infoUrl/);
  assert.throws(() => docusaurus.validateOptions({ options: { languages: ['go'] } }), /go/);
});

check('plugin packs the index and prefixes baseUrl onto infoUrl', () => {
  const siteDir = tempSite();
  fs.mkdirSync(path.join(siteDir, 'static', 'quickinfo'), { recursive: true });
  fs.writeFileSync(
    path.join(siteDir, 'static', 'quickinfo', 'names.json'),
    JSON.stringify({ version: '7', ids: IDS, bases: BASES }),
  );
  const options = docusaurus.validateOptions({ options: {} });
  const instance = docusaurus.default({ siteDir, baseUrl: '/docs/' }, options);
  assert.strictEqual(
    instance.getThemePath(),
    path.join(__dirname, '..', 'lib', 'docusaurus', 'theme'),
  );
  const { alias } = instance.configureWebpack().resolve;
  const packed = JSON.parse(fs.readFileSync(alias['quickinfo/data$'], 'utf8'));
  assert.deepStrictEqual(unpackNames(packed).ids.sort(), [...IDS].sort());
  assert.strictEqual(packed.version, '7');
  const config = JSON.parse(fs.readFileSync(alias['quickinfo/config$'], 'utf8'));
  assert.strictEqual(config.infoUrl, '/docs/quickinfo/info.json');
});

check('plugin with a missing index packs an empty one', () => {
  const siteDir = tempSite();
  const instance = docusaurus.default({ siteDir, baseUrl: '/' }, { dataFile: 'nope.json' });
  const packed = JSON.parse(
    fs.readFileSync(instance.configureWebpack().resolve.alias['quickinfo/data$'], 'utf8'),
  );
  assert.deepStrictEqual(packed.tree, {});
});

// --- shared helpers ---------------------------------------------------------

const { withBase } = require('../lib/lib/options');

check('packed names round-trip', () => {
  const names = {
    ids: ['a', 'pkg.mod.A', 'pkg.mod.A.b', 'pkg.B'],
    bases: { 'pkg.B': ['pkg.mod.A'] },
  };
  const round = unpackNames(packNames(names));
  assert.deepStrictEqual(round.ids.sort(), [...names.ids].sort());
  assert.deepStrictEqual(round.bases, names.bases);
});

check('withBase resolves root-relative URLs under the base path', () => {
  assert.strictEqual(withBase('/quickinfo/info.json', '/docs/'), '/docs/quickinfo/info.json');
  // A path that merely starts like the base is still inside the site.
  assert.strictEqual(
    withBase('/quickinfo/names.json', '/quickinfo'),
    '/quickinfo/quickinfo/names.json',
  );
  assert.strictEqual(withBase('/quickinfo/info.json', '/'), '/quickinfo/info.json');
  assert.strictEqual(withBase('quickinfo/info.json', '/docs/'), 'quickinfo/info.json');
  assert.strictEqual(
    withBase('https://cdn.example/x.json', '/docs/'),
    'https://cdn.example/x.json',
  );
  assert.strictEqual(withBase('//cdn.example/x.json', '/docs/'), '//cdn.example/x.json');
});

check('resolveHref reads Sphinx, mkdocstrings, and doc-path links', () => {
  const index = makeIndex();
  assert.strictEqual(resolveHref('reference/pathlib.html#pathlib.Path', index), 'pathlib.Path');
  assert.strictEqual(
    resolveHref('../reference/mock/#unittest.mock.MagicMock', index),
    'unittest.mock.MagicMock',
  );
  assert.strictEqual(resolveHref('/api/generated/json.dumps.md', index), 'json.dumps');
  assert.strictEqual(resolveHref('collections.OrderedDict.md', index), 'collections.OrderedDict');
  assert.strictEqual(resolveHref('#module-json', index), undefined);
  assert.strictEqual(resolveHref('https://example.com/guide', index), undefined);
});

check('prose dotted suffix resolves when unique and stays cold when shared', () => {
  const index = buildIndex(['a.x.run', 'b.y.run', 'a.x.Graph'], {}, []);
  assert.strictEqual(resolveProseMention('x.Graph', index), 'a.x.Graph');
  assert.strictEqual(resolveProseMention('run', index), undefined);
  assert.strictEqual(resolveProseMention('y.run()', index), 'b.y.run');
});

check('doctest prompts parse like plain source', () => {
  const code = '>>> from pathlib import (\n...     Path,\n... )\n>>> cfg = Path("x")';
  assert.deepStrictEqual(parsePythonImports(code), { Path: 'pathlib.Path' });
  assert.ok(isAnnotatedLanguage('pycon'));
});

// --- CLI: inventory, extraction, build ------------------------------------

const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { readInventory } = require('../lib/cli/inventory');
const { extractPage } = require('../lib/cli/extract');
const CLI = path.join(__dirname, '..', 'lib', 'cli', 'index.js');

function inventory(lines) {
  const header =
    '# Sphinx inventory version 2\n# Project: toy\n# Version: 1\n' +
    '# The remainder of this file is compressed using zlib.\n';
  return Buffer.concat([Buffer.from(header), zlib.deflateSync(Buffer.from(lines.join('\n')))]);
}

const INVENTORY_LINES = [
  'toy.driver py:module 0 driver.html#module-$ -',
  'toy.driver.Device py:class 1 driver.html#$ -',
  'toy.driver.Device.id py:property 1 driver.html#$ -',
  'toy.driver.Accelerator py:class 1 driver.html#$ -',
  // autodoc's canonical-name duplicate and an mkdocstrings inherited alias
  'toy.driver._impl.Device py:class -1 driver.html#toy.driver.Device -',
  'toy.driver.Accelerator.id py:property 2 driver.html#toy.driver.Device.id -',
  'guide std:doc -1 guide.html Guide',
];

check('inventory keeps own-anchor Python entries and drops aliases', () => {
  const entries = readInventory(inventory(INVENTORY_LINES));
  assert.deepStrictEqual(
    entries.map((e) => `${e.name} ${e.role} ${e.uri}`),
    [
      'toy.driver module driver.html#module-toy.driver',
      'toy.driver.Device class driver.html#toy.driver.Device',
      'toy.driver.Device.id property driver.html#toy.driver.Device.id',
      'toy.driver.Accelerator class driver.html#toy.driver.Accelerator',
    ],
  );
});

const SPHINX_PAGE = `<dl class="py class">
<dt class="sig sig-object py" id="toy.driver.Accelerator">
<span class="property"><span class="pre">class</span> </span><span class="sig-prename descclassname"><span class="pre">toy.driver.</span></span><span class="sig-name descname"><span class="pre">Accelerator</span></span><span class="sig-paren">(</span><em class="sig-param"><span class="pre">id</span>: <span class="pre">int</span> = <span class="pre">0</span></em><span class="sig-paren">)</span><a class="reference internal" href="_modules/toy/driver.html#Accelerator"><span class="viewcode-link"><span class="pre">[source]</span></span></a><a class="headerlink" href="#toy.driver.Accelerator" title="Link to this definition">¶</a></dt>
<dd><p>Bases: <a class="reference internal" href="#toy.driver.Device" title="toy.driver.Device"><code class="xref py py-class docutils literal notranslate"><span class="pre">Device</span></code></a></p>
<p>A GPU or other
accelerator device.</p>
<p>Second paragraph.</p>
</dd></dl>`;

const MKDOCS_PAGE = `<div class="doc doc-object doc-attribute">
<h3 id="toy.driver.Device.id" class="doc doc-heading">
  <span class="doc doc-object-name doc-attribute-name">id</span>
</h3>
<div class="doc-signature highlight"><pre><span></span><code><span class="nb">id</span><span class="p">:</span> <span class="nb">int</span>
</code></pre></div>
<div class="doc doc-contents ">
  <p>The integer identifier.</p>
</div></div>
<div class="doc doc-object doc-class">
<h2 id="toy.driver.Accelerator" class="doc doc-heading">
  <span class="doc doc-object-name doc-class-name">Accelerator</span>
</h2>
<div class="doc doc-contents ">
  <p class="doc doc-class-bases">Bases: <code><a class="autorefs autorefs-internal" href="#toy.driver.Device">Device</a></code></p>
  <p>A GPU or other accelerator device.</p>
</div></div>`;

const TOY_IDS = new Set(['toy.driver.Device', 'toy.driver.Device.id', 'toy.driver.Accelerator']);

check('extracts Sphinx autodoc signature, summary, and bases', () => {
  const out = new Map();
  extractPage(SPHINX_PAGE, TOY_IDS, out);
  assert.deepStrictEqual(out.get('toy.driver.Accelerator'), {
    sig: 'class toy.driver.Accelerator(id: int = 0)',
    doc: 'A GPU or other accelerator device.',
    bases: ['toy.driver.Device'],
  });
});

check('extracts mkdocstrings signature, summary, and bases', () => {
  const out = new Map();
  extractPage(MKDOCS_PAGE, TOY_IDS, out);
  assert.deepStrictEqual(out.get('toy.driver.Device.id'), {
    sig: 'id: int',
    doc: 'The integer identifier.',
    bases: [],
  });
  assert.deepStrictEqual(out.get('toy.driver.Accelerator'), {
    sig: 'class Accelerator(Device)',
    doc: 'A GPU or other accelerator device.',
    bases: ['toy.driver.Device'],
  });
});

check('quickinfo build writes data and script beside each other', () => {
  const site = tempSite();
  fs.mkdirSync(path.join(site, '_static'));
  fs.writeFileSync(path.join(site, 'objects.inv'), inventory(INVENTORY_LINES));
  fs.writeFileSync(path.join(site, 'driver.html'), SPHINX_PAGE);
  execFileSync(
    process.execPath,
    [path.join(__dirname, '..', 'lib', 'cli', 'index.js'), 'build', site],
    {
      stdio: 'pipe',
    },
  );
  const out = path.join(site, '_static', 'quickinfo');
  const names = JSON.parse(fs.readFileSync(path.join(out, 'names.json'), 'utf8'));
  const info = JSON.parse(fs.readFileSync(path.join(out, 'info.json'), 'utf8'));
  assert.strictEqual(names.ids.length, 4);
  assert.deepStrictEqual(names.bases, { 'toy.driver.Accelerator': ['toy.driver.Device'] });
  assert.match(names.version, /^[0-9a-f]{12}$/);
  // Links are relative to info.json, which sits two levels below the root.
  assert.strictEqual(
    info['toy.driver.Accelerator'].url,
    '../../driver.html#toy.driver.Accelerator',
  );
  assert.strictEqual(info['toy.driver.Accelerator'].kind, 'class');
  assert.ok(fs.existsSync(path.join(out, 'quickinfo.js')));
});

check('quickinfo build links from where --out is served', () => {
  const site = tempSite();
  fs.writeFileSync(path.join(site, 'objects.inv'), inventory(INVENTORY_LINES));
  const docsOut = path.join(tempSite(), 'docs', 'quickinfo');
  execFileSync(process.execPath, [CLI, 'build', site, '--out', docsOut, '--no-assets'], {
    stdio: 'pipe',
  });
  const info = JSON.parse(fs.readFileSync(path.join(docsOut, 'info.json'), 'utf8'));
  // Served at <root>/quickinfo/, one level below the root.
  assert.strictEqual(info['toy.driver.Device'].url, '../driver.html#toy.driver.Device');
  execFileSync(
    process.execPath,
    [CLI, 'build', site, '--out', docsOut, '--served-at', 'assets/qi', '--no-assets'],
    { stdio: 'pipe' },
  );
  const info2 = JSON.parse(fs.readFileSync(path.join(docsOut, 'info.json'), 'utf8'));
  assert.strictEqual(info2['toy.driver.Device'].url, '../../driver.html#toy.driver.Device');
});

check('quickinfo build version changes when a docstring does', () => {
  const site = tempSite();
  fs.mkdirSync(path.join(site, '_static'));
  fs.writeFileSync(path.join(site, 'objects.inv'), inventory(INVENTORY_LINES));
  const version = () => {
    execFileSync(process.execPath, [CLI, 'build', site, '--no-assets'], { stdio: 'pipe' });
    return JSON.parse(
      fs.readFileSync(path.join(site, '_static', 'quickinfo', 'names.json'), 'utf8'),
    ).version;
  };
  fs.writeFileSync(path.join(site, 'driver.html'), SPHINX_PAGE);
  const before = version();
  fs.writeFileSync(path.join(site, 'driver.html'), SPHINX_PAGE.replace('A GPU', 'An accelerator'));
  assert.notStrictEqual(version(), before);
});

check('quickinfo build survives malformed escapes in links', () => {
  const out = new Map();
  extractPage(SPHINX_PAGE.replace('href="#toy.driver.Device"', 'href="#bad%zz"'), TOY_IDS, out);
  assert.deepStrictEqual(out.get('toy.driver.Accelerator').bases, []);
});

check('quickinfo build fails clearly without an inventory', () => {
  const site = tempSite();
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [path.join(__dirname, '..', 'lib', 'cli', 'index.js'), 'build', site],
        {
          stdio: 'pipe',
        },
      ),
    (err) => /no inventory at/.test(String(err.stderr)),
  );
});

// jiti (the config loader of Docusaurus, Astro, and Blume) calls a file ESM
// when this regex matches its raw source, comments included; an ESM verdict
// drops a `module.exports =` default and the site config fails to load.
// Copied from jiti's hasESMSyntax.
const JITI_ESM_RE =
  /(?:[\s;]|^)(?:import[\s\w*,{}]*from|import\s*["'*{]|export\b\s*(?:[*{]|default|class|type|function|const|var|let|async function)|import\.meta\b)/m;

for (const entry of ['index.js', 'rehype.js', 'docusaurus/index.js', 'astro/index.js']) {
  check(`compiled ${entry} reads as CJS to jiti`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', entry), 'utf8');
    const match = source.match(JITI_ESM_RE);
    assert.strictEqual(match, null, match && source.slice(match.index - 40, match.index + 40));
  });
}

check('rehype entry returns the plugin function itself', () => {
  assert.strictEqual(typeof require('../lib/rehype'), 'function');
});

check('docusaurus client modules ship as ES modules', () => {
  for (const file of ['theme/Root.js', 'theme/CodeBlock/Line/index.js', 'runtime.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'docusaurus', file), 'utf8');
    assert.match(source, /^(import|export) /m, file);
    assert.doesNotMatch(source, /\brequire\(|\bexports\./, file);
  }
});

console.log(`\n${passed} checks passed${process.exitCode ? '' : ' - all green'}`);
