/**
 * Astro integration for IDE-style API hover on Astro sites, Blume
 * included: `apiHover()` from `docusaurus-plugin-api-hover/astro`.
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
 * (`virtual:api-hover/config`) so no global state or generated file is
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
import type { ApiHoverClientConfig } from './runtime';
import path from 'path';

type InjectScript = (stage: 'page' | 'before-hydration', content: string) => void;
type UpdateConfig = (config: {
  vite?: { plugins?: unknown[]; optimizeDeps?: { exclude?: string[] } };
}) => void;

interface ConfigSetupParams {
  injectScript: InjectScript;
  updateConfig: UpdateConfig;
}

const VIRTUAL_ID = 'virtual:api-hover/config';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const CLIENT_ID = 'docusaurus-plugin-api-hover/astro-client';

function configVitePlugin(config: ApiHoverClientConfig) {
  return {
    name: 'api-hover-config',
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

function apiHover(options: apiHover.ApiHoverAstroOptions): apiHover.ApiHoverIntegration {
  if (typeof options !== 'object' || options === null) {
    throw new Error('api-hover: options must be an object');
  }
  if (typeof options.namesUrl !== 'string' || options.namesUrl.length === 0) {
    throw new Error('api-hover: "namesUrl" is required (URL of the names JSON)');
  }
  if (options.infoUrl !== undefined && typeof options.infoUrl !== 'string') {
    throw new Error('api-hover: "infoUrl" must be a string');
  }
  for (const key of ['preferPrefixes', 'languages'] as const) {
    const value = options[key];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    ) {
      throw new Error(`api-hover: "${key}" must be an array of strings`);
    }
  }
  const invalid = (options.languages as unknown[] | undefined)?.filter((lang) => lang !== 'python');
  if (invalid && invalid.length > 0) {
    throw new Error(
      `api-hover: unknown languages ${JSON.stringify(invalid)}; ` + 'built in: "python"',
    );
  }
  const config: ApiHoverClientConfig = {
    namesUrl: options.namesUrl,
    infoUrl: options.infoUrl || '/data/api-hover-info.json',
    preferPrefixes: options.preferPrefixes ?? [],
    languages: options.languages ?? ['python'],
  };
  return {
    name: 'docusaurus-plugin-api-hover',
    hooks: {
      'astro:config:setup': ({ injectScript, updateConfig }: ConfigSetupParams) => {
        updateConfig({
          vite: {
            plugins: [configVitePlugin(config)],
            // Dev: the client entry is transformed from source, so it must
            // stay out of the dep optimizer (which would prebundle the
            // CJS build and fail on the virtual-module import).
            optimizeDeps: { exclude: ['docusaurus-plugin-api-hover'] },
          },
        });
        injectScript('page', "import 'docusaurus-plugin-api-hover/astro-client';");
      },
    },
  };
}

namespace apiHover {
  /**
   * URL the browser fetches the names JSON from (the index generator's
   * output, served as a static file). Shape:
   * {ids: string[], bases?: Record<string, string[]>, version?: string}.
   */
  export type ApiHoverAstroOptions = {
    namesUrl: string;
    /** URL the runtime fetches the info JSON from (with ?v=version appended).
     * Defaults to /data/api-hover-info.json. */
    infoUrl?: string;
    /**
     * Id prefixes that win a short-name collision, e.g. ["max."] on a site
     * that indexes both MAX symbols and Python stdlib ids.
     */
    preferPrefixes?: string[];
    /** Language modules to enable for code annotation. Built in: "python". */
    languages?: string[];
  };

  export type ApiHoverClientConfig = import('./runtime').ApiHoverClientConfig;

  export type ApiHoverIntegration = {
    name: string;
    hooks: { 'astro:config:setup': (params: ConfigSetupParams) => void };
  };
}

export = apiHover;
