/**
 * The names JSON, and the packed form the Docusaurus client bundle
 * carries. Packing groups ids by parent (`{"pathlib": ["Path", "PurePath"]}`),
 * which roughly halves the raw size of a large index: the client parses
 * less JavaScript on every page.
 */

/** The names JSON an index generator writes. */
export interface NamesJson {
  /** Every documented symbol id, as full dotted names. */
  ids: string[];
  /** Class id to its direct documented base class ids. */
  bases?: Record<string, string[]>;
  /** Busts the info JSON's cache when the index changes. */
  version?: string;
}

/** The names JSON with ids grouped by parent. */
export interface PackedNames {
  /** Parent id (`""` for top level) to its members' final segments. */
  tree: Record<string, string[]>;
  bases?: Record<string, string[]>;
  version?: string;
}

/**
 * Group a names JSON's ids by parent.
 *
 * @param names The names JSON.
 * @returns The packed form, with `bases` and `version` carried over.
 */
export function packNames(names: NamesJson): PackedNames {
  const tree: Record<string, string[]> = {};
  for (const id of names.ids) {
    const dot = id.lastIndexOf('.');
    (tree[dot < 0 ? '' : id.slice(0, dot)] ??= []).push(id.slice(dot + 1));
  }
  return { tree, bases: names.bases, version: names.version };
}

/**
 * Expand a packed names JSON back to full dotted ids.
 *
 * @param packed The packed form.
 * @returns The names JSON.
 */
export function unpackNames(packed: PackedNames): NamesJson {
  const ids: string[] = [];
  for (const [parent, names] of Object.entries(packed.tree)) {
    for (const name of names) ids.push(parent ? `${parent}.${name}` : name);
  }
  return { ids, bases: packed.bases, version: packed.version };
}
