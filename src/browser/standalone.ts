/**
 * The standalone script for Sphinx, MkDocs, and any other static site:
 * one `<script defer>` tag that injects the styles, then boots quickinfo
 * with options read from the tag's data attributes.
 *
 * Data URLs default to `names.json` and `info.json` next to the script
 * itself, so a site that keeps the three files together needs no
 * attributes at all, at any page depth.
 */
import styles from './styles.css';
import { initQuickinfo } from './init';

/**
 * Options for the standalone script, set as data attributes on its
 * `<script>` tag (`data-names-url`, `data-prefer-prefixes`, ...). Relative
 * URLs resolve against the script's own URL.
 */
export interface ScriptAttributes {
  /**
   * URL of the names JSON.
   * @default 'names.json' (next to the script)
   */
  namesUrl?: string;
  /**
   * URL of the info JSON.
   * @default 'info.json' (next to the script)
   */
  infoUrl?: string;
  /**
   * Comma-separated id prefixes that win a short-name collision, e.g.
   * `max.,mypkg.`.
   * @default none
   */
  preferPrefixes?: string;
  /**
   * Comma-separated language modules to enable. Built in: `python`.
   * @default 'python'
   */
  languages?: string;
  /**
   * Language assumed for code blocks with no language marker. Set it to
   * `python` when the highlighter emits no language class; on MkDocs,
   * enable pymdownx.highlight's `pygments_lang_class` instead.
   * @default none
   */
  defaultLanguage?: string;
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function boot(script: HTMLScriptElement | null): void {
  if (!document.querySelector('style[data-quickinfo]')) {
    const style = document.createElement('style');
    style.setAttribute('data-quickinfo', '');
    style.textContent = styles;
    document.head.append(style);
  }
  const data: ScriptAttributes = script?.dataset ?? {};
  // Relative data URLs resolve against the script, not the page.
  const base = script?.src || document.baseURI;
  const resolve = (url: string) => new URL(url, base).href;
  void initQuickinfo({
    namesUrl: resolve(data.namesUrl ?? 'names.json'),
    infoUrl: resolve(data.infoUrl ?? 'info.json'),
    preferPrefixes: list(data.preferPrefixes, []),
    languages: list(data.languages, ['python']),
    defaultLanguage: data.defaultLanguage,
  });
}

// currentScript is only set while the script first runs.
const script = document.currentScript as HTMLScriptElement | null;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => boot(script), { once: true });
} else {
  boot(script);
}
