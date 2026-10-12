/**
 * Generates the API reference page and the site's hover data from the
 * plugin's TypeScript sources, so signatures, parameters, options, and
 * defaults have one source of truth: the JSDoc in src/.
 *
 * Outputs:
 *  - docs/(reference)/api-reference.mdx: one section per entry point, with a
 *    signature block and a Blume TypeTable for each function's parameters
 *    and each interface's properties.
 *  - public/quickinfo/names.json and info.json: the index and tooltip
 *    data the site's own quickinfo() integration serves, plus the real MAX
 *    entries in demo/max.json for the introduction's live example.
 *
 * JSDoc read per declaration: the comment body (description; its first
 * paragraph is the tooltip text), @param, @returns, @default, @example.
 *
 * Usage: node scripts/gen-api.mjs [--check]
 * --check writes nothing and exits 1 when a generated file is out of date.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const website = path.resolve(here, '..');
const root = path.resolve(website, '..');

/**
 * Reference links in info.json, relative to info.json itself
 * (public/quickinfo/info.json): the runtime resolves them against the info
 * JSON's URL, so they follow the site's deploy base.
 */
const PAGE_ROUTE = '../api-reference';

/**
 * Page layout. An item is a declaration name, or `{ name, file }` when it
 * lives outside the section's file. `bareMembers` sections publish each
 * property under its bare name only (`dataFile`), first section wins, so
 * prose mentions of an option resolve without the interface prefix.
 * `usage` names a string constant rendered as a code block (CLI help).
 */
const SECTIONS = [
  {
    title: 'Docusaurus plugin',
    file: 'src/docusaurus/index.ts',
    importFrom: 'quickinfo/docusaurus',
    items: [
      'pluginQuickinfo',
      'validateOptions',
      'PluginOptions',
      {
        name: 'QuickinfoRuntime',
        file: 'src/docusaurus/runtime.tsx',
        importFrom: 'quickinfo/docusaurus/runtime',
      },
    ],
    bareMembers: true,
  },
  {
    title: 'Rehype pass',
    file: 'src/rehype.ts',
    importFrom: 'quickinfo/rehype',
    items: ['rehypeQuickinfo', 'RehypeQuickinfoOptions'],
    bareMembers: true,
  },
  {
    title: 'Astro integration',
    file: 'src/astro/index.ts',
    importFrom: 'quickinfo/astro',
    items: ['quickinfo', 'QuickinfoAstroOptions'],
    bareMembers: true,
  },
  {
    title: 'Standalone script',
    file: 'src/browser/standalone.ts',
    intro:
      'The script for Sphinx, MkDocs, and any other static site, shipped as ' +
      '`quickinfo/browser` and copied next to its data by the CLI. Options ' +
      'are data attributes on its script tag.',
    items: ['ScriptAttributes'],
  },
  {
    title: 'CLI',
    file: 'src/cli/index.ts',
    intro:
      'Builds hover data from a built Sphinx or MkDocs (mkdocstrings) site: ' +
      'ids, kinds, and links from `objects.inv`, and signatures, summaries, ' +
      'and base classes from the API pages.',
    usage: 'USAGE',
    items: [],
  },
  {
    title: 'Browser runtime',
    file: 'src/browser/init.ts',
    intro:
      'What the Astro integration and the standalone script run on every ' +
      'page. Sites reach it through those adapters.',
    items: ['initQuickinfo', 'QuickinfoClientConfig'],
  },
  {
    title: 'Resolution engine',
    file: 'src/lib/annotate.ts',
    importFrom: 'quickinfo',
    intro:
      'Pure functions over the index that `buildIndex` returns, shared by ' +
      'every adapter: the Docusaurus theme components, the rehype pass, and ' +
      'the browser annotator.',
    items: [
      'buildIndex',
      'getSnippetContext',
      'resolveApiName',
      'resolveMember',
      'resolveProseMention',
      'resolveHref',
      'resolveDotted',
      'annotateLines',
      'isAnnotatedLanguage',
      { name: 'packNames', file: 'src/lib/names.ts' },
      { name: 'unpackNames', file: 'src/lib/names.ts' },
      'SymbolIndex',
      'SnippetContext',
      'PrismToken',
      { name: 'NamesJson', file: 'src/lib/names.ts' },
      { name: 'PackedNames', file: 'src/lib/names.ts' },
    ],
  },
];

/** Tooltip badge per item; functions and interfaces default by node kind. */
const KINDS = {
  pluginQuickinfo: 'plugin',
  rehypeQuickinfo: 'plugin',
  quickinfo: 'integration',
  QuickinfoRuntime: 'component',
  ScriptAttributes: 'attributes',
};

// --- source reading -------------------------------------------------------

function findDeclaration(sourceFile, name) {
  let found;
  const visit = (node) => {
    if (found) return;
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)) &&
      node.name?.text === name
    ) {
      found = node;
      return;
    }
    if (ts.isModuleDeclaration(node) || ts.isModuleBlock(node) || ts.isSourceFile(node)) {
      ts.forEachChild(node, visit);
    }
  };
  visit(sourceFile);
  return found;
}

/** The declaration's last JSDoc block: body text plus tags. */
function readJsDoc(node) {
  const blocks = (node.jsDoc ?? []).filter(ts.isJSDoc);
  const block = blocks[blocks.length - 1];
  if (!block) return { text: '', tags: [] };
  return {
    text: ts.getTextOfJSDocComment(block.comment) ?? '',
    tags: block.tags ?? [],
  };
}

function tagText(tag) {
  return (ts.getTextOfJSDocComment(tag.comment) ?? '').trim();
}

/** JSDoc prose wraps at 80 columns; rejoin lines, keep paragraph breaks. */
function unwrap(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function firstParagraph(text) {
  return unwrap(text).split('\n\n')[0] ?? '';
}

function readFunction(node, sourceFile) {
  const doc = readJsDoc(node);
  const paramDocs = new Map();
  let returns = '';
  const examples = [];
  for (const tag of doc.tags) {
    if (ts.isJSDocParameterTag(tag))
      paramDocs.set(tag.name.getText(sourceFile), unwrap(tagText(tag)));
    else if (tag.tagName.text === 'returns') returns = unwrap(tagText(tag));
    else if (tag.tagName.text === 'example') examples.push(tagText(tag));
  }
  const params = node.parameters.map((p) => {
    const name = p.name.getText(sourceFile);
    // A destructured parameter (`{ options }`) takes its @param doc from
    // the names it binds.
    const docKeys = ts.isObjectBindingPattern(p.name)
      ? p.name.elements.map((e) => e.name.getText(sourceFile))
      : [name];
    return {
      name,
      type: p.type ? p.type.getText(sourceFile) : 'unknown',
      required: !p.questionToken && !p.initializer,
      default: p.initializer?.getText(sourceFile),
      description: docKeys.map((k) => paramDocs.get(k)).find(Boolean) ?? '',
    };
  });
  const returnType = node.type ? node.type.getText(sourceFile) : 'void';
  const typeParams = node.typeParameters
    ? `<${node.typeParameters.map((t) => t.getText(sourceFile)).join(', ')}>`
    : '';
  const signature =
    `${node.name.text}${typeParams}(` +
    params.map((p) => `${p.name}${p.required ? '' : '?'}: ${p.type}`).join(', ') +
    `): ${returnType}`;
  return {
    kind: 'function',
    description: unwrap(doc.text),
    signature,
    params,
    returns: { type: returnType, description: returns },
    examples,
  };
}

function readInterface(node, sourceFile) {
  const doc = readJsDoc(node);
  const members = ts.isInterfaceDeclaration(node)
    ? node.members
    : ts.isTypeLiteralNode(node.type)
      ? node.type.members
      : [];
  const props = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const mdoc = readJsDoc(member);
    const defaultTag = mdoc.tags.find((t) => t.tagName.text === 'default');
    props.push({
      name: member.name.getText(sourceFile),
      type: member.type ? member.type.getText(sourceFile) : 'unknown',
      required: !member.questionToken,
      default: defaultTag ? tagText(defaultTag) : undefined,
      description: unwrap(mdoc.text),
    });
  }
  return {
    kind: 'interface',
    description: unwrap(doc.text),
    examples: doc.tags.filter((t) => t.tagName.text === 'example').map(tagText),
    props,
  };
}

/** A string constant's value (a plain or template literal without
 * substitutions). */
function readStringConstant(sourceFile, name) {
  let found;
  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (decl.name.getText(sourceFile) !== name || !decl.initializer) continue;
      if (
        ts.isStringLiteral(decl.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(decl.initializer)
      ) {
        found = decl.initializer.text;
      }
    }
  });
  return found;
}

// --- rendering ------------------------------------------------------------

/** Escape MDX-significant characters outside inline code spans. */
function mdx(text) {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(/[{}]/g, (c) => `\\${c}`).replace(/</g, '&lt;'),
    )
    .join('');
}

function typeTable(rows) {
  const entries = {};
  for (const row of rows) {
    entries[row.name] = {
      type: row.type,
      ...(row.required ? { required: true } : {}),
      ...(row.default !== undefined ? { default: row.default } : {}),
      // TypeTable renders descriptions as plain text: drop code-span ticks.
      ...(row.description ? { description: plain(row.description) } : {}),
    };
  }
  return `<TypeTable type={${JSON.stringify(entries, null, 2)}} />`;
}

function renderExamples(examples) {
  // An @example body is either a fenced block already or bare code.
  return examples.map((ex) => (ex.startsWith('```') ? ex : `\`\`\`ts\n${ex}\n\`\`\``));
}

function renderItem(name, item) {
  const out = [`### ${name}`, ''];
  if (item.importFrom) out.push(`Import from \`${item.importFrom}\`.`, '');
  if (item.description) out.push(mdx(item.description), '');
  if (item.kind === 'function') {
    out.push('```ts', item.signature, '```', '');
    if (item.params.length > 0) out.push('#### Parameters', '', typeTable(item.params), '');
    if (item.returns.description || item.returns.type !== 'void') {
      out.push(
        `Returns \`${item.returns.type}\`${item.returns.description ? `: ${mdx(item.returns.description)}` : '.'}`,
        '',
      );
    }
  } else if (item.props.length > 0) {
    out.push(typeTable(item.props), '');
  }
  for (const ex of renderExamples(item.examples)) out.push(ex, '');
  return out;
}

function renderPage(sections) {
  const out = [
    '---',
    'title: API reference',
    'description: Every export, option, and data file the plugin ships.',
    '---',
    '',
    '{/* Generated by scripts/gen-api.mjs from the JSDoc in src/. Edit the',
    '    source comments, then run `npm run gen:api`. */}',
    '',
    'Every export, option, and data file the plugin ships, generated from the',
    "plugin's source. The hovers on this page run through the plugin's own",
    'Astro integration, with the names JSON and info JSON generated from the',
    'same source.',
    '',
  ];
  for (const section of sections) {
    out.push(`## ${section.title}`, '');
    if (section.importFrom) out.push(`Import from \`${section.importFrom}\`.`, '');
    if (section.intro) out.push(mdx(section.intro), '');
    if (section.usageText) out.push('```text', section.usageText, '```', '');
    for (const [name, item] of section.items) {
      out.push(...renderItem(name, item));
    }
  }
  out.push(
    '## Data files',
    '',
    'The schemas of the names JSON and the info JSON are documented in',
    '[index files](/index-files).',
    '',
  );
  return out.join('\n');
}

// --- hover data -----------------------------------------------------------

function plain(text) {
  return text.replace(/`/g, '');
}

function buildHoverData(sections) {
  const info = {};
  const add = (id, entry) => {
    if (!(id in info)) info[id] = entry;
  };
  for (const section of sections) {
    for (const [name, item] of section.items) {
      const url = `${PAGE_ROUTE}#${name.toLowerCase()}`;
      add(name, {
        kind: KINDS[name] ?? item.kind,
        ...(item.kind === 'function' ? { sig: item.signature } : {}),
        doc: plain(firstParagraph(item.description)),
        url,
      });
      if (item.kind !== 'interface') continue;
      for (const prop of item.props) {
        const entry = {
          kind: section.bareMembers ? 'option' : 'property',
          sig: `${prop.name}${prop.required ? '' : '?'}: ${prop.type}`,
          doc: plain(
            firstParagraph(prop.description) + (prop.default ? ` Default: ${prop.default}.` : ''),
          ).trim(),
          url,
        };
        // Option interfaces publish each option once, under its bare name
        // (first section wins), so prose `dataFile` names one symbol. A
        // `PluginOptions.dataFile` id beside it would make the bare name
        // ambiguous.
        add(section.bareMembers ? prop.name : `${name}.${prop.name}`, entry);
      }
    }
  }
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  // The introduction's live example hovers real MAX symbols; their data
  // lives in demo/max.json, beside the generated quickinfo symbols.
  const demo = JSON.parse(readFileSync(path.join(website, 'demo/max.json'), 'utf8'));
  for (const id of demo.ids) add(id, demo.info[id]);
  return { names: { version, ids: Object.keys(info), bases: demo.bases }, info };
}

// --- main -----------------------------------------------------------------

const sourceFiles = new Map();
function sourceFile(file) {
  if (!sourceFiles.has(file)) {
    const filePath = path.join(root, file);
    sourceFiles.set(
      file,
      ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true),
    );
  }
  return sourceFiles.get(file);
}

const sections = SECTIONS.map((section) => {
  const items = section.items.map((entry) => {
    const {
      name,
      file = section.file,
      importFrom,
    } = typeof entry === 'string' ? { name: entry } : entry;
    const source = sourceFile(file);
    const node = findDeclaration(source, name);
    if (!node) throw new Error(`gen-api: ${name} not found in ${file}`);
    const item = ts.isFunctionDeclaration(node)
      ? readFunction(node, source)
      : readInterface(node, source);
    if (!item.description) throw new Error(`gen-api: ${name} in ${file} has no JSDoc`);
    return [name, { ...item, importFrom }];
  });
  let usageText;
  if (section.usage) {
    usageText = readStringConstant(sourceFile(section.file), section.usage);
    if (!usageText) throw new Error(`gen-api: ${section.usage} not found in ${section.file}`);
  }
  return { ...section, items, usageText };
});

const { names, info } = buildHoverData(sections);
const outputs = [
  [path.join(website, 'docs/(reference)/api-reference.mdx'), renderPage(sections)],
  [path.join(website, 'public/quickinfo/names.json'), `${JSON.stringify(names, null, 2)}\n`],
  [path.join(website, 'public/quickinfo/info.json'), `${JSON.stringify(info, null, 2)}\n`],
];

const check = process.argv.includes('--check');
let stale = false;
for (const [file, content] of outputs) {
  let current;
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    current = undefined;
  }
  if (current === content) continue;
  if (check) {
    console.error(`gen-api: ${path.relative(website, file)} is out of date; run npm run gen:api`);
    stale = true;
  } else {
    writeFileSync(file, content);
    console.log(`gen-api: wrote ${path.relative(website, file)}`);
  }
}
if (stale) process.exit(1);
