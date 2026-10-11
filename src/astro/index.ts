/**
 * Astro integration for IDE-style API hover on Astro sites, Blume
 * included: `quickinfo()` from `quickinfo/astro`.
 *
 * Unlike the Docusaurus theme, which annotates at build time off the
 * prism token stream, this integration annotates in the browser: one
 * script injected on every page fetches the names JSON, stamps
 * `data-api-id` onto prose mentions and Python code blocks in the DOM,
 * and wires the tooltip runtime. Browser-side annotation is what makes
 * the integration independent of the site's Markdown processor (Blume's
 * Sätteri renders code with Shiki before any rehype plugin could see it)
 * and lets it work identically in dev and production.
 *
 * The options reach the browser through a Vite virtual module
 * (`virtual:quickinfo/config`) so no global state or generated file is
 * needed; the entry (`./astro-client`) is injected with Astro's
 * injectScript, and the integration's Vite plugin redirects that import
 * to the client's TypeScript source so dev and build resolve it the
 * same way.
 *
 * The export shape is `export =` (module.exports is the factory itself,
 * the classic Express-style pattern): loaders that natively import the
 * CJS build see module.exports as the ESM default, bundlers get the
 * named exports through interop, and plain require() calls the function
 * directly.
 */
import path from 'path';
import type { QuickinfoClientConfig } from '../browser/init';
import { checkCommonOptions, DEFAULT_INFO_URL, DEFAULT_NAMES_URL, withBase } from '../lib/options';

type InjectScript = (stage: 'page' | 'before-hydration', content: string) => void;
type UpdateConfig = (config: {
  vite?: { plugins?: unknown[]; optimizeDeps?: { exclude?: string[] } };
}) => void;

interface ConfigSetupParams {
  config?: { base?: string };
  injectScript: InjectScript;
  updateConfig: UpdateConfig;
}

const VIRTUAL_ID = 'virtual:quickinfo/config';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const CLIENT_ID = 'quickinfo/astro-client';

function configVitePlugin(config: QuickinfoClientConfig) {
  return {
    name: 'quickinfo-config',
    // pre: Vite's own resolver would claim the bare client specifier via
    // the package exports before this plugin could redirect it to source.
    enforce: 'pre' as const,
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      // The client entry resolves to its TypeScript source in dev and
      // build alike. The compiled CJS client cannot run as a browser
      // module, and Vite's dev optimizer cannot prebundle it: the
      // virtual-module and ?inline imports only resolve inside Vite's own
      // pipeline. Kept out of optimization (below), the source flows
      // through the normal transform pipeline instead.
      if (id === CLIENT_ID) return path.resolve(__dirname, '../../src/astro/client.ts');
      return null;
    },
    load(id: string) {
      return id === RESOLVED_VIRTUAL_ID ? `export default ${JSON.stringify(config)}` : null;
    },
  };
}

/**
 * The Astro integration, for Blume and plain Astro sites. Injects one
 * script on every page that fetches the names JSON, stamps `data-api-id`
 * onto prose mentions and Python code blocks in the DOM, and wires the
 * tooltip. Annotation runs in the browser, so it works with any Markdown
 * processor and behaves the same in dev and production.
 *
 * @param options Integration options.
 * @returns The Astro integration to add to `integrations`.
 * @example
 * ```ts
 * import quickinfo from 'quickinfo/astro';
 * import { defineConfig } from 'astro/config';
 *
 * // Serves public/quickinfo/names.json and info.json; no options needed.
 * export default defineConfig({
 *   integrations: [quickinfo()],
 * });
 * ```
 */
function quickinfo(options?: quickinfo.QuickinfoAstroOptions): quickinfo.QuickinfoIntegration {
  if (options !== undefined && (typeof options !== 'object' || options === null)) {
    throw new Error('quickinfo: options must be an object');
  }
  const raw = options ?? {};
  checkCommonOptions(raw as Record<string, unknown>);
  return {
    name: 'quickinfo',
    hooks: {
      'astro:config:setup': ({
        config: astroConfig,
        injectScript,
        updateConfig,
      }: ConfigSetupParams) => {
        // Root-relative URLs get the site's base path, so the defaults
        // work on a site served under a subpath.
        const base = astroConfig?.base;
        const config: QuickinfoClientConfig = {
          namesUrl: withBase(raw.namesUrl ?? DEFAULT_NAMES_URL, base),
          infoUrl: withBase(raw.infoUrl ?? DEFAULT_INFO_URL, base),
          preferPrefixes: raw.preferPrefixes ?? [],
          languages: raw.languages ?? ['python'],
        };
        updateConfig({
          vite: {
            plugins: [configVitePlugin(config)],
            // Dev: the client entry is transformed from source, so it must
            // stay out of the dep optimizer (which would prebundle the
            // CJS build and fail on the virtual-module import).
            optimizeDeps: { exclude: ['quickinfo'] },
          },
        });
        injectScript('page', "import 'quickinfo/astro-client';");
      },
    },
  };
}

namespace quickinfo {
  /** Options for the Astro integration, passed to `quickinfo()`. */
  export type QuickinfoAstroOptions = {
    /**
     * URL the browser fetches the names JSON from. A root-relative URL
     * gets the site's `base` prefixed. Shape:
     * `{ids: string[], bases?: Record<string, string[]>, version?: string}`.
     * @default '/quickinfo/names.json'
     */
    namesUrl?: string;
    /**
     * URL the runtime fetches the info JSON from, with `?v=<version>`
     * appended from the names JSON. A root-relative URL gets the site's
     * `base` prefixed.
     * @default '/quickinfo/info.json'
     */
    infoUrl?: string;
    /**
     * Id prefixes that win a short-name collision, e.g. `["max."]` on a site
     * that indexes both MAX symbols and Python stdlib ids.
     * @default []
     */
    preferPrefixes?: string[];
    /**
     * Language modules to enable for code annotation. Built in: `"python"`.
     * @default ['python']
     */
    languages?: string[];
  };

  export type QuickinfoClientConfig = import('../browser/init').QuickinfoClientConfig;

  export type QuickinfoIntegration = {
    name: string;
    hooks: { 'astro:config:setup': (params: ConfigSetupParams) => void };
  };
}

export = quickinfo;
