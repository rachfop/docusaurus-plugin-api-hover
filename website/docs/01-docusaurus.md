---
title: Set up Docusaurus
description: Register the quickinfo plugin and rehype pass in a Docusaurus site.
---

On Docusaurus, quickinfo annotates at build time. The plugin annotates code
blocks as they render, and the rehype pass annotates prose mentions, so the
HTML ships with every symbol already marked.

## Add the data files

Generate the [names JSON and info JSON](/index-files) in a prebuild step and
write both to `static/quickinfo/`. The plugin reads
`static/quickinfo/names.json` at build time, and the browser fetches
`/quickinfo/info.json` on first hover.

If the names JSON doesn't exist when the build starts, the plugin builds
with an empty index and logs a warning. Hovers stay inert until you generate
the index.

## Register the plugin

Register the plugin for code blocks and the rehype pass for prose:

```js
const quickinfoRehype = require('quickinfo/rehype');

module.exports = {
  plugins: [require.resolve('quickinfo/docusaurus')],
  presets: [
    [
      'classic',
      {
        docs: { rehypePlugins: [quickinfoRehype] },
        pages: { rehypePlugins: [quickinfoRehype] },
      },
    ],
  ],
};
```

Register the rehype pass for every content plugin whose pages mention API
symbols: `docs`, `pages`, and `blog` each take their own `rehypePlugins`. A
mention inside a link to the symbol's page takes its id from the href, so
linked mentions resolve even when the bare name is ambiguous.

Both read `static/quickinfo/names.json` by default, relative to the site
directory. To keep the files elsewhere, pass
[`dataFile`](/api-reference#pluginoptions) to the plugin and the rehype pass,
and [`infoUrl`](/api-reference#pluginoptions) to the plugin. A root-relative
`infoUrl` resolves under the site's `baseUrl`.

## Leave pages unannotated

An index describes one API at one version. Pages for another language or
another version, such as a stable copy of the docs next to the nightly
index, would show the wrong symbols. Exclude them from both passes: the
plugin's [`exclude`](/api-reference#pluginoptions) takes route prefixes for
code blocks, and the rehype pass's
[`exclude`](/api-reference#rehypequickinfooptions) takes source paths for
prose:

```js
plugins: [[require.resolve('quickinfo/docusaurus'), { exclude: ['/stable/'] }]],
// ...
docs: {
  rehypePlugins: [[quickinfoRehype, { exclude: ['versioned_docs/'] }]],
},
```

## Sites that ship their own Root

Docusaurus renders the `Root` of the last plugin that provides one. The
quickinfo plugin's `Root` starts the hover runtime, so when a plugin
registered after it ships its own `Root`, mount the runtime yourself, in a
swizzled layout provider:

```js
import QuickinfoRuntime from 'quickinfo/docusaurus/runtime';

// In src/theme/Layout/Provider/index.tsx:
// composeProviders([..., QuickinfoRuntime])
```

`QuickinfoRuntime` loads the hover styles along with the runtime.
