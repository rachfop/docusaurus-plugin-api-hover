/**
 * quickinfo: IDE-style hover tooltips for API symbols on docs sites.
 *
 * The package root exports the resolution engine, for tools that build
 * their own adapter. Site adapters live under subpaths:
 * `quickinfo/docusaurus`, `quickinfo/rehype`, `quickinfo/astro`, the
 * standalone `quickinfo/browser` script, and the `quickinfo` CLI.
 */
export {
  annotateLines,
  buildIndex,
  getSnippetContext,
  isAnnotatedLanguage,
  resolveApiName,
  resolveDotted,
  isExternalHref,
  resolveHref,
  resolveMember,
  resolveProseMention,
  type PrismToken,
  type SnippetContext,
  type SymbolIndex,
} from './lib/annotate';
export { packNames, unpackNames, type NamesJson, type PackedNames } from './lib/names';
