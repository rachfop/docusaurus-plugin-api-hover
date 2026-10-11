#!/usr/bin/env node
/**
 * The quickinfo CLI.
 *
 *   quickinfo build <site-dir> [--out <dir>] [--served-at <path>] [--inventory <file>] [--no-assets]
 *   quickinfo assets <dir>
 *
 * `build` turns a built Sphinx or MkDocs (mkdocstrings) site into hover
 * data: ids, kinds, and reference links from the site's `objects.inv`;
 * signatures, docstring summaries, and base classes from its API pages.
 * It writes names.json, info.json, and the standalone script into one
 * directory, so the script finds its data with no configuration.
 *
 * `assets` copies only the standalone script, for sites that write their
 * own names and info JSON.
 */
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { extractPage, type ExtractedSymbol } from './extract';
import { kindForRole, readInventory } from './inventory';

const USAGE = `Usage:
  quickinfo build <site-dir> [--out <dir>] [--served-at <path>] [--inventory <file>] [--no-assets]
  quickinfo assets <dir>

build   Write names.json, info.json, and quickinfo.js for a built Sphinx or
        MkDocs (mkdocstrings) site, from its objects.inv and API pages.
        --out        Output directory. Default: <site-dir>/_static/quickinfo
                     when _static exists (Sphinx), else <site-dir>/quickinfo.
        --served-at  Where the output is served, relative to the site root.
                     Default: --out's path inside <site-dir>, or its folder
                     name when --out is outside the site (a docs folder the
                     generator copies to the root, like docs/quickinfo).
        --inventory  The objects.inv to read. Default: <site-dir>/objects.inv.
        --no-assets  Skip copying quickinfo.js.
assets  Copy quickinfo.js into <dir>.`;

const SCRIPT = path.join(__dirname, '..', 'browser', 'quickinfo.js');

function fail(message: string): never {
  console.error(`quickinfo: ${message}\n\n${USAGE}`);
  process.exit(1);
}

/** Top-level output folders with no API pages: Sphinx's highlighted
 * sources, copied sources, and static files; MkDocs' assets and search. */
const SKIPPED_ROOT_DIRS = ['_modules', '_sources', '_static', 'assets', 'search'];

function* htmlFiles(dir: string, root = true): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!(root && SKIPPED_ROOT_DIRS.includes(entry.name))) yield* htmlFiles(full, false);
    } else if (entry.name.endsWith('.html')) {
      yield full;
    }
  }
}

function copyScript(outDir: string): void {
  if (!existsSync(SCRIPT)) fail(`standalone script missing at ${SCRIPT}; reinstall quickinfo`);
  mkdirSync(outDir, { recursive: true });
  copyFileSync(SCRIPT, path.join(outDir, 'quickinfo.js'));
}

function build(args: string[]): void {
  let siteDir: string | undefined;
  let outDir: string | undefined;
  let inventoryPath: string | undefined;
  let servedAt: string | undefined;
  let assets = true;
  for (let k = 0; k < args.length; k++) {
    const arg = args[k]!;
    if (arg === '--out') outDir = args[++k];
    else if (arg === '--inventory') inventoryPath = args[++k];
    else if (arg === '--served-at') servedAt = args[++k];
    else if (arg === '--no-assets') assets = false;
    else if (arg.startsWith('-')) fail(`unknown option ${arg}`);
    else if (!siteDir) siteDir = arg;
    else fail(`unexpected argument ${arg}`);
  }
  if (!siteDir) fail('build needs the built site directory');
  siteDir = path.resolve(siteDir);
  outDir = path.resolve(
    outDir ??
      (existsSync(path.join(siteDir, '_static'))
        ? path.join(siteDir, '_static', 'quickinfo')
        : path.join(siteDir, 'quickinfo')),
  );
  inventoryPath = path.resolve(inventoryPath ?? path.join(siteDir, 'objects.inv'));
  if (!existsSync(inventoryPath)) {
    fail(
      `no inventory at ${inventoryPath}. Sphinx writes objects.inv on every HTML build; ` +
        'MkDocs writes it through mkdocstrings.',
    );
  }

  const entries = readInventory(readFileSync(inventoryPath));
  if (entries.length === 0) fail(`${inventoryPath} lists no Python objects`);
  const ids = new Set(entries.map((e) => e.name));

  const extracted = new Map<string, ExtractedSymbol>();
  for (const file of htmlFiles(siteDir)) extractPage(readFileSync(file, 'utf8'), ids, extracted);

  // Reference links are stored relative to where info.json is served; the
  // runtime resolves them against the info JSON's own URL, so they work at
  // any page depth and under any deploy path.
  const inside = path.relative(siteDir, outDir);
  const served = (
    servedAt ??
    (inside && !inside.startsWith('..') && !path.isAbsolute(inside)
      ? inside
      : path.basename(outDir))
  )
    .split(/[\\/]+/)
    .filter((segment) => segment && segment !== '.');
  const toRoot = served.map(() => '..').join('/');
  const info: Record<string, { kind: string; sig?: string; doc?: string; url: string }> = {};
  const bases: Record<string, string[]> = {};
  for (const entry of entries) {
    const found = extracted.get(entry.name);
    info[entry.name] = {
      kind: kindForRole(entry.role),
      ...(found?.sig ? { sig: found.sig } : {}),
      ...(found?.doc ? { doc: found.doc } : {}),
      url: toRoot ? `${toRoot}/${entry.uri}` : entry.uri,
    };
    if (found?.bases.length) bases[entry.name] = found.bases;
  }
  // The version busts cached info JSON, so it hashes what the tooltips
  // show: a docstring edit changes it even when objects.inv doesn't.
  const infoJson = JSON.stringify(info);
  const version = createHash('sha256')
    .update(infoJson)
    .update(JSON.stringify(bases))
    .digest('hex')
    .slice(0, 12);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'names.json'), JSON.stringify({ version, ids: [...ids], bases }));
  writeFileSync(path.join(outDir, 'info.json'), infoJson);
  if (assets) copyScript(outDir);
  const shown = path.relative(process.cwd(), outDir);
  console.log(
    `quickinfo: ${ids.size} symbols (${extracted.size} with signatures) -> ${shown && !shown.startsWith('..') ? shown : outDir}`,
  );
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'build') build(rest);
else if (command === 'assets') {
  if (!rest[0]) fail('assets needs a directory');
  copyScript(path.resolve(rest[0]));
  console.log(`quickinfo: wrote ${path.join(rest[0], 'quickinfo.js')}`);
} else if (command === '--help' || command === '-h' || command === undefined) {
  console.log(USAGE);
} else fail(`unknown command ${command}`);
