/**
 * The runtime config (infoUrl, preferPrefixes, languages) is written by the
 * plugin at site-config time and injected as the aliased module
 * `docusaurus-plugin-api-hover/config`, the same mechanism as the data
 * file. Declared for tsc; resolved by the site's bundler.
 */
declare module 'docusaurus-plugin-api-hover/config' {
  const config: {
    infoUrl: string;
    preferPrefixes: string[];
    languages: string[];
  };
  export default config;
}

// tsc emits CJS; `require` is Node's, not ESModule interop.
declare function require(id: string): unknown;
declare namespace require {
  function resolve(id: string, opts?: { paths?: string[] }): string;
}
