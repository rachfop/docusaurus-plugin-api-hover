/**
 * Tests for the annotation core (lib/annotate) and the rehype plugin.
 * Plain Node: no build tools, requires the compiled lib/.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildApiHoverIndex,
  resolveApiName,
  resolveMember,
  annotateLines,
  isAnnotatedLanguage,
} = require('../lib/lib/annotate');

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
  'max.driver.CPU',
  'max.driver.Accelerator',
  'max.driver.Device.id',
  'max.driver.Device',
  'max.driver.Buffer',
  'max.graph.Graph',
  'max.graph.Graph.inputs',
  'max.graph.Graph.output',
  'max.graph.ops.relu',
  'max.nn.kernels.TensorValue',
  'max.nn.kernels.AlgebraicDim',
  'collections.abc.Sequence',
];
const BASES = { 'max.driver.Accelerator': ['max.driver.Device'] };
const PREFER = ['max.'];

function makeIndex() {
  return buildApiHoverIndex(IDS, BASES, PREFER);
}

// --- resolveApiName -------------------------------------------------------

check('exact id resolves to itself', () => {
  assert.strictEqual(resolveApiName('max.graph.Graph', {}, makeIndex()), 'max.graph.Graph');
});

check('import alias resolves bare name', () => {
  assert.strictEqual(
    resolveApiName('CPU', { driver: 'max.driver' }, makeIndex()),
    'max.driver.CPU',
  );
});

check('alias resolves dotted member chain', () => {
  assert.strictEqual(
    resolveApiName('graph.Graph.inputs', { graph: 'max.graph' }, makeIndex()),
    'max.graph.Graph.inputs',
  );
});

check('globally unique short name resolves', () => {
  assert.strictEqual(
    resolveApiName('AlgebraicDim', {}, makeIndex()),
    'max.nn.kernels.AlgebraicDim',
  );
});

check('ambiguous short name stays cold', () => {
  // "value" is documented on two unrelated classes; the short name
  // alone cannot pick one, so it stays un-annotated.
  const ids = ['pkg.Foo.value', 'other.Bar.value'];
  const index = buildApiHoverIndex(ids, {}, []);
  assert.strictEqual(resolveApiName('value', {}, index), undefined);
});

check('preferPrefixes breaks short-name collisions', () => {
  const ids = ['max.driver.Buffer', 'collections.abc.Buffer'];
  const index = buildApiHoverIndex(ids, {}, ['max.']);
  assert.strictEqual(resolveApiName('Buffer', {}, index), 'max.driver.Buffer');
});

check('unresolvable name stays cold', () => {
  assert.strictEqual(resolveApiName('NotASymbol', {}, makeIndex()), undefined);
});

// --- inherited members ------------------------------------------------------

check('inherited member resolves through bases', () => {
  const index = makeIndex();
  assert.strictEqual(resolveMember(index, 'max.driver.Accelerator', 'id'), 'max.driver.Device.id');
});

check('own member wins over inherited', () => {
  const index = buildApiHoverIndex(
    [
      'max.driver.Accelerator.id',
      'max.driver.Accelerator',
      'max.driver.Device.id',
      'max.driver.Device',
    ],
    { 'max.driver.Accelerator': ['max.driver.Device'] },
    [],
  );
  assert.strictEqual(
    resolveMember(index, 'max.driver.Accelerator', 'id'),
    'max.driver.Accelerator.id',
  );
});

check('undocumented member stays cold', () => {
  assert.strictEqual(resolveMember(makeIndex(), 'max.driver.Accelerator', 'nope'), undefined);
});

// --- language gating --------------------------------------------------------

check('python language variants are annotated', () => {
  assert.ok(isAnnotatedLanguage('python'));
  assert.ok(isAnnotatedLanguage('py'));
  assert.ok(isAnnotatedLanguage('python3'));
});

check('non-python languages are skipped', () => {
  assert.strictEqual(isAnnotatedLanguage('mojo'), false);
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
  const code = 'from max import driver\n';
  const out = annotate(code, flatLine('CPU'));
  assert.deepStrictEqual(apiIds(out), ['CPU:max.driver.CPU']);
});

check('dotted chain annotates each resolvable segment', () => {
  const code = 'from max import graph\n';
  const out = annotate(code, flatLine('graph.Graph'));
  // The alias segment itself stays cold (`max.graph` is not an indexed
  // symbol); the class segment resolves through the alias.
  assert.deepStrictEqual(apiIds(out), ['Graph:max.graph.Graph']);
});

check('undotted identifier inside operators is annotated', () => {
  const code = 'from max import driver\ndriver.CPU()\n';
  const out = annotate(code, flatLine('driver.CPU()'));
  // `driver` alone is not an id (module pages lack anchors in this
  // fixture), but CPU resolves through the alias.
  assert.deepStrictEqual(apiIds(out), ['CPU:max.driver.CPU']);
});

check('with-as binds annotate the bound name', () => {
  const code = 'from max.graph import ops as relu_ops\n';
  const out = annotate(code, flatLine('relu_ops.relu'));
  assert.deepStrictEqual(apiIds(out), ['relu:max.graph.ops.relu']);
});

check('inferred local type annotates attribute access', () => {
  const code = 'from max import driver\ndev = driver.Accelerator()\n';
  const out = annotate(code, flatLine('dev.id'));
  // The local variable itself stays cold; the attribute resolves to the
  // member inherited from the documented base class.
  assert.deepStrictEqual(apiIds(out), ['id:max.driver.Device.id']);
});

check('non-python lines pass through untouched', () => {
  const line = [{ types: 'plain', content: 'CPU' }];
  assert.strictEqual(annotateLines(line, 'x', 'mojo', index), line);
});

check('input line is never mutated', () => {
  const line = flatLine('CPU');
  annotate('from max import driver\n', line);
  assert.strictEqual(line[0].apiId, undefined);
  assert.strictEqual(line.length, 1);
});

// --- rehype plugin ----------------------------------------------------------

const rehype = require('../lib/rehype');

function tempDataFile(payload) {
  const file = path.join(
    os.tmpdir(),
    `api-hover-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
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
  const transform = rehype.default({ dataFile, preferPrefixes: PREFER });
  const tree = el('root', [el('p', [el('code', [text('AlgebraicDim')])])]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), ['AlgebraicDim=>max.nn.kernels.AlgebraicDim']);
});

check('rehype skips code inside pre blocks', () => {
  const dataFile = tempDataFile({ ids: IDS });
  const transform = rehype.default({ dataFile, preferPrefixes: PREFER });
  const tree = el('root', [el('pre', [el('code', [text('CPU')])])]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), []);
});

check('rehype link href is authoritative for the id', () => {
  const dataFile = tempDataFile({ ids: IDS });
  const transform = rehype.default({ dataFile, preferPrefixes: PREFER });
  const tree = el('root', [
    el('p', [
      el('a', [el('code', [text('Buffer')])], {
        href: '/api/python/generated/max.driver.Buffer.md',
      }),
    ]),
  ]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), ['Buffer=>max.driver.Buffer']);
});

check('rehype stays cold on ambiguous prose mention', () => {
  const dataFile = tempDataFile({
    ids: ['max.driver.Buffer', 'collections.abc.Buffer'],
  });
  const transform = rehype.default({ dataFile });
  const tree = el('root', [el('p', [el('code', [text('Buffer')])])]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), []);
});

check('rehype with missing data file annotates nothing', () => {
  const transform = rehype.default({ dataFile: '/nonexistent/nope.json' });
  const tree = el('root', [el('p', [el('code', [text('AlgebraicDim')])])]);
  transform(tree);
  assert.deepStrictEqual(collectApiIds(tree), []);
});

check('rehype requires dataFile option', () => {
  assert.throws(() => rehype.default({}), /dataFile/);
});

// --- plugin entry -----------------------------------------------------------

check('plugin default export is a docusaurus plugin factory', () => {
  const plugin = require('../lib/index');
  const factory = typeof plugin === 'function' ? plugin : plugin.default;
  assert.strictEqual(typeof factory, 'function');
  const instance = factory({ siteDir: '/tmp' }, { dataFile: '/nonexistent/nope.json' });
  assert.ok(instance);
  assert.strictEqual(instance.getThemePath(), path.join(__dirname, '..', 'lib', 'theme'));
});

console.log(`\n${passed} checks passed${process.exitCode ? '' : ' - all green'}`);
