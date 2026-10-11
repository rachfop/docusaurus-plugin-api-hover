/**
 * The packed names JSON and the runtime config (infoUrl, preferPrefixes,
 * languages) are written by the plugin at site-config time and injected as
 * the aliased modules `quickinfo/data` and `quickinfo/config`. Declared for
 * tsc; resolved by the site's bundler.
 */
declare module 'quickinfo/data' {
  const data: {
    tree: Record<string, string[]>;
    bases?: Record<string, string[]>;
    version?: string;
  };
  export default data;
}

declare module 'quickinfo/config' {
  const config: {
    infoUrl: string;
    preferPrefixes: string[];
    languages: string[];
    exclude: string[];
  };
  export default config;
}

// tsc emits CJS; `require` is Node's, not ESModule interop.
declare function require(id: string): unknown;
declare namespace require {
  function resolve(id: string, opts?: { paths?: string[] }): string;
}

/** The package's own stylesheet export; the site's bundler loads it. */
declare module 'quickinfo/styles';
