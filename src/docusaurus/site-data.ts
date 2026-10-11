/**
 * The site's index and runtime config on Docusaurus. The plugin's webpack
 * config aliases `quickinfo/data` to the packed names JSON and
 * `quickinfo/config` to the options it writes at config time; outside a
 * Docusaurus build the package's own fallbacks (an empty index, default
 * options) answer those imports.
 */
import data from 'quickinfo/data';
import config from 'quickinfo/config';
import { buildIndex, type SymbolIndex } from '../lib/annotate';
import { unpackNames, type NamesJson, type PackedNames } from '../lib/names';

interface SiteConfig {
  infoUrl: string;
  preferPrefixes: string[];
  languages: string[];
  exclude: string[];
}

let namesCache: NamesJson | undefined;
let indexCache: SymbolIndex | undefined;

function names(): NamesJson {
  namesCache ??= unpackNames(data as PackedNames);
  return namesCache;
}

/** The plugin options the runtime needs, with defaults applied. */
export function siteConfig(): SiteConfig {
  return config as SiteConfig;
}

/** The index built from the site's names JSON. */
export function getSiteIndex(): SymbolIndex {
  indexCache ??= buildIndex(names().ids, names().bases ?? {}, siteConfig().preferPrefixes);
  return indexCache;
}

/** Version string from the names JSON; busts the info JSON's cache. */
export function getInfoVersion(): string {
  return names().version ?? '';
}
