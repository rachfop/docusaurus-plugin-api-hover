/**
 * Option checks and URL defaults shared by the Docusaurus plugin and the
 * Astro integration. The checks are plain code: Docusaurus mixes a
 * plugin's joi schema into its own joi instance, and a second joi copy
 * fails with "Cannot mix different versions of joi schemas".
 */

/** Where the names JSON is served unless an option says otherwise. */
export const DEFAULT_NAMES_URL = '/quickinfo/names.json';
/** Where the info JSON is served unless an option says otherwise. */
export const DEFAULT_INFO_URL = '/quickinfo/info.json';

const LANGUAGES = ['python'];

/** Throws on a malformed shared option: string URLs, string-array lists,
 * and only built-in languages. */
export function checkCommonOptions(raw: Record<string, unknown>): void {
  for (const key of ['namesUrl', 'infoUrl', 'apiBasePath']) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') {
      throw new Error(`quickinfo: "${key}" must be a string`);
    }
  }
  for (const key of ['preferPrefixes', 'languages']) {
    const value = raw[key];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    ) {
      throw new Error(`quickinfo: "${key}" must be an array of strings`);
    }
  }
  const unknown = ((raw.languages as string[] | undefined) ?? []).filter(
    (lang) => !LANGUAGES.includes(lang),
  );
  if (unknown.length > 0) {
    throw new Error(
      `quickinfo: unknown languages ${JSON.stringify(unknown)}; built in: ${JSON.stringify(LANGUAGES)}`,
    );
  }
}

/**
 * Resolve a root-relative URL under a site's base path, so
 * `/quickinfo/info.json` works on a site served under `/docs/`: like a
 * static asset path, a root-relative option URL names a path inside the
 * site. Relative and absolute URLs pass through.
 */
export function withBase(url: string, base: string | undefined): string {
  const prefix = (base ?? '/').replace(/\/+$/, '');
  if (!prefix || !url.startsWith('/') || url.startsWith('//')) return url;
  return `${prefix}${url}`;
}
