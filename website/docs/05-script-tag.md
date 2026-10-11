---
title: Add to any static site
description: Load quickinfo with a script tag on Hugo, Jekyll, or plain HTML docs.
---

Any static site can load quickinfo with one script tag. The script fetches
the data files, marks Python code blocks and prose mentions in the page, and
runs the tooltip. It reads the rendered HTML, so it works with Pygments,
Prism, Shiki, and highlight.js output alike, and it re-annotates when
client-side navigation or a late highlighter changes the page.

## Add the files

Generate the [names JSON and info JSON](/index-files), and copy the script
next to them:

```bash
npx quickinfo assets static/quickinfo
```

The command writes `static/quickinfo/quickinfo.js`. Put `names.json` and
`info.json` in the same directory.

## Load the script

Add the tag to your page template:

```html
<script defer src="/quickinfo/quickinfo.js"></script>
```

The script finds `names.json` and `info.json` next to itself. To load data
from elsewhere, or to change what gets annotated, set
[data attributes](/api-reference#scriptattributes) on the tag:

```html
<script
  defer
  src="/quickinfo/quickinfo.js"
  data-names-url="/api/names.json"
  data-default-language="python"
></script>
```

`data-default-language` covers highlighters that mark no language on code
blocks. With it set, every unmarked block is read as Python.

## Colors

The tooltip takes its colors from CSS variables that default to the host
theme's palette on Docusaurus, MkDocs Material, Furo, and Blume, with a
light fallback everywhere else. Set them on `body` to match any other
theme:

```css
body {
  --quickinfo-bg: #fff;
  --quickinfo-fg: #1f2328;
  --quickinfo-border: #d0d7de;
  --quickinfo-accent: #0969da;
  --quickinfo-link: #0969da;
  --quickinfo-highlight: #fff8c5;
  --quickinfo-code-bg: #f6f8fa;
  --quickinfo-underline: #8c959f;
}
```
