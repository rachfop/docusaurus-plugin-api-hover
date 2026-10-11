/**
 * Reads a Sphinx inventory (`objects.inv`, format version 2), the object
 * index Sphinx writes for intersphinx and mkdocstrings writes for the same
 * purpose. It lists every documented object with its role and the page
 * and anchor that document it.
 */
import { inflateSync } from 'zlib';

export interface InventoryEntry {
  /** Full dotted name, e.g. `toyapi.driver.Accelerator`. */
  name: string;
  /** Python role without the domain, e.g. `class` or `method`. */
  role: string;
  /** Page and anchor relative to the site root, `$` expanded. */
  uri: string;
}

/** Python roles become these tooltip badges. */
const KINDS: Record<string, string> = {
  module: 'module',
  class: 'class',
  exception: 'exception',
  function: 'function',
  method: 'method',
  classmethod: 'method',
  staticmethod: 'method',
  property: 'property',
  attribute: 'attribute',
  data: 'data',
  type: 'type',
};

export function kindForRole(role: string): string {
  return KINDS[role] ?? role;
}

const LINE_RE = /^(.+?)\s+(\S+?):(\S+)\s+(-?\d+)\s+(\S*)\s+(.*)$/;

/**
 * Parse the inventory and keep the Python objects documented under their
 * own name: an entry whose anchor names a different object is an alias
 * (a re-export, an inherited member, autodoc's canonical-name duplicate),
 * and keeping aliases would make every aliased short name ambiguous.
 */
export function readInventory(buffer: Buffer): InventoryEntry[] {
  let offset = 0;
  const header: string[] = [];
  for (let k = 0; k < 4; k++) {
    const end = buffer.indexOf(0x0a, offset);
    if (end < 0) throw new Error('quickinfo: objects.inv header is truncated');
    header.push(buffer.subarray(offset, end).toString('utf8'));
    offset = end + 1;
  }
  if (!(header[0] ?? '').startsWith('# Sphinx inventory version 2')) {
    throw new Error(`quickinfo: unsupported inventory format: ${header[0]}`);
  }
  const body = inflateSync(buffer.subarray(offset)).toString('utf8');
  const entries: InventoryEntry[] = [];
  const seen = new Set<string>();
  for (const line of body.split('\n')) {
    const match = line.match(LINE_RE);
    if (!match) continue;
    const [, name, domain, role, , rawUri] = match as unknown as string[];
    if (domain !== 'py' || !name || !role || seen.has(name)) continue;
    const uri = rawUri!.endsWith('$') ? rawUri!.slice(0, -1) + name : rawUri!;
    const anchor = decodeURIComponent(uri.split('#')[1] ?? '');
    const own = anchor === name || (role === 'module' && anchor === `module-${name}`);
    if (!own) continue;
    seen.add(name);
    entries.push({ name, role, uri });
  }
  return entries;
}
