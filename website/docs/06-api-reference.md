---
title: API reference
description: Every export, option, and data file the plugin ships.
---

Every export, option, and data file the plugin ships, in one place. The
hovers on this page run through the plugin's own Astro integration: the
names JSON and info JSON under the site's `api-hover/` path describe the
plugin's own symbols.

## Docusaurus plugin

### pluginApiHover

The plugin entry, wired in `docusaurus.config.js`:

```js
module.exports = {
  plugins: [
    [require.resolve('docusaurus-plugin-api-hover'), { dataFile: 'data/api-hover-names.json' }],
  ],
};
```

It registers the theme components that annotate code blocks, aliases the
names JSON and the runtime config into the client bundle, and mounts the
hover runtime through `Root`. Prose mentions are annotated at build time by
the rehype pass, registered separately.

### validateOptions

Validates `PluginOptions` by hand. The site mixes the plugin's schema into
its own joi instance, and a second joi copy fails to mix, so the plugin
ships plain checks.

### Options

| Option           | Default                     | What it does                                |
| ---------------- | --------------------------- | ------------------------------------------- |
| `dataFile`       | none                        | Path to the generated names JSON.           |
| `infoUrl`        | `/data/api-hover-info.json` | URL the browser fetches the info JSON from. |
| `preferPrefixes` | `[]`                        | Id prefixes that win short-name collisions. |
| `languages`      | `['python']`                | Languages to annotate. Built in: `python`.  |

## Rehype pass

### rehypeApiHover

The rehype companion, registered in the markdown config. It stamps
`data-api-id` onto prose mentions at build time: inline code and linked
mentions that resolve to exactly one symbol. A link to an API page is
authoritative and wins even when the bare name is ambiguous.

It takes `dataFile`, `preferPrefixes`, and `apiBasePath`, which sets which
link hrefs count as links to API pages (default `/api`).

## Astro integration

### apiHover

Astro integration for Blume and plain Astro sites, from
`docusaurus-plugin-api-hover/astro`:

```ts
import apiHover from 'docusaurus-plugin-api-hover/astro';
import { defineConfig } from 'blume';

export default defineConfig({
  integrations: [
    apiHover({
      namesUrl: '/api-hover/names.json',
      infoUrl: '/api-hover/info.json',
    }),
  ],
});
```

The integration injects one script on every page. The script fetches the
names JSON, stamps `data-api-id` onto prose mentions and Python code blocks
in the DOM, and wires the tooltip. Annotation runs in the browser, so the
integration works with any Markdown processor and behaves the same in dev
and production. The `infoUrl` and `namesUrl` options are URLs the browser
fetches; on a site served under a base path, include the base path in them.

## Browser runtime

### initApiHover

The entry the integration injects. It takes an `ApiHoverAstroOptions`
object, loads the names JSON, annotates the document, and attaches the
hover listeners at the document level. Touch screens get no tooltips: the
underline affordance is hidden there, and a tap should not pop a tooltip
that cannot be reached.

## Resolution engine

The engine is a set of pure functions over the index that
`buildApiHoverIndex` returns. The theme components and the browser
annotator share it.

### buildApiHoverIndex

Builds `ApiHoverIndex` from the names JSON's ids, bases record, and
`preferPrefixes`. The index holds the id set, the short-name map, the
member map (parent id to member name to defining id), the base map, and a
memo for inherited-member lookups.

### getSnippetContext

Parses a Python snippet once into `SnippetContext`: import aliases,
inferred locals (`device = driver.Accelerator()` gives `device` the type
`max.driver.Accelerator`), and every name the snippet binds.

### resolveApiName

Resolves a dotted name against the index using import aliases first, then
a globally-unique short name. Ambiguous names stay cold.

### resolveMember

Finds a member's defining id on a class, walking the documented base
classes when the class doesn't define the member itself.

### resolveProseMention

Resolves a prose mention: an exact dotted name, a unique dotted suffix, or
a unique bare name. Collisions stay cold unless a `preferPrefixes` entry
breaks the tie.

### resolveDotted

Resolves one dotted occurrence in a snippet. Import aliases keep their API
meaning, inferred locals resolve member access through the inheritance
chain, and any other bound name stays cold.

### annotateLines

Annotates one prism-rendered line of tokens: each identifier piece gets
`apiId` when it resolves against the index. Returns a new array and never
mutates the input.

### isAnnotatedLanguage

Whether code blocks in a prism language get annotated.

### Interfaces

`ApiHoverIndex`, `SnippetContext`, `PrismToken`, `PluginOptions`,
`RehypeApiHoverOptions`, and `ApiHoverAstroOptions` are the exported types.
The schemas of the names JSON and info JSON the engine consumes are
documented in [index files](/index-files).
