---
title: Quick start
description: Register the plugin and the rehype pass in a Docusaurus site.
---

Register the plugin for code blocks, and the rehype pass for prose mentions.
The plugin annotates code blocks as they render; the rehype pass annotates
prose at build time. The plugin entry also needs the names JSON, which you
generate in a prebuild step (see [Index files](/index-files)).

```js
const path = require('path');
const apiHoverRehype = require('docusaurus-plugin-api-hover/rehype');

const dataFile = path.resolve(__dirname, 'generated/api-hover-names.json');

module.exports = {
  plugins: [
    [
      'docusaurus-plugin-api-hover',
      {
        dataFile,
        infoUrl: '/data/api-hover-info.json',
        preferPrefixes: [],
        languages: ['python'],
      },
    ],
  ],
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          rehypePlugins: [[apiHoverRehype, { dataFile }]],
        },
      },
    ],
  ],
  markdown: {
    rehypePlugins: [[apiHoverRehype, { dataFile }]],
  },
};
```

Register the rehype pass wherever markdown is rendered: in the docs plugin
config for docs pages, and in the top-level `markdown` config for MDX pages.
A mention inside a link to the symbol's page takes its id from the href, so
links resolve even when the bare name is ambiguous.

Serve the info JSON from `static/` so it's available at `infoUrl`.

If `dataFile` doesn't exist when the build starts, the plugin falls back to an
empty index. The build succeeds and hovers stay inert until you generate the
index.
