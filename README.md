# quickinfo

In an editor, hovering a symbol shows its signature and documentation,
which the language server provides through the Language Server Protocol
(LSP). quickinfo brings that hover to your API docs. Code blocks, inline
code, and links that reference a documented symbol get a dotted underline.
Hover one and a tooltip shows the symbol's kind, full name, signature,
docstring summary, and a link to its reference page, and every other mention
of the symbol on the page lights up. Readers can scan an API without leaving
the page they're on. Keyboard focus opens the same tooltip, and Escape
closes it.

quickinfo works with Docusaurus, Astro and Blume, Sphinx, MkDocs, and any
other static site generator.

Resolution is snippet-aware. After `import json`, the name `json.dumps`
resolves to `json.dumps`. After `config = Path("app.toml")` with
`from pathlib import Path`, the attribute `config.name` resolves to
`pathlib.PurePath.name`: `Path` doesn't define `name` itself, so quickinfo
follows its documented base class, `PurePath`.

Hovers read a names JSON listing the symbols, and an info JSON with
signatures and doc summaries that the browser fetches on first hover. On
Sphinx and MkDocs, `quickinfo build` writes both from the built site.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/hover-dark.png">
  <img src="media/hover-light.png" alt="Hovering dumps in a Python code example on quickinfo's docs site shows a tooltip with the FUNCTION badge, the full name json.dumps, its signature, its doc summary, and a link to its reference page.">
</picture>

The screenshot is captured from quickinfo's own docs site, where the hovers
run through the Astro integration. CI regenerates it on every
change, so the README always shows the tool as it currently behaves.

## Install

```bash
npm install quickinfo
```

## Set up your site

The [docs site](https://rachfop.github.io/quickinfo/) has a full setup page
for each generator. The short versions:

**Docusaurus.** Put `names.json` and `info.json` in `static/quickinfo/`, then
register the plugin for code blocks and the rehype pass for prose:

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

**Astro and Blume.** Put the data files in `public/quickinfo/` and add the
integration:

```ts
import quickinfo from 'quickinfo/astro';

export default defineConfig({ integrations: [quickinfo()] });
```

**Sphinx.** Load the script in `conf.py`, then build the data after each
Sphinx build:

```python
html_js_files = [("quickinfo/quickinfo.js", {"defer": "defer"})]
```

```bash
sphinx-build -b html docs docs/_build/html
npx quickinfo build docs/_build/html
```

**MkDocs** with mkdocstrings. Load the script and mark code block
languages in `mkdocs.yml`, then build the data after each MkDocs build:

```yaml
extra_javascript:
  - path: quickinfo/quickinfo.js
    defer: true
markdown_extensions:
  - pymdownx.highlight:
      pygments_lang_class: true
```

```bash
mkdocs build
npx quickinfo build site
```

**Any other static site generator.** Copy the script next to your data
files with `npx quickinfo assets <dir>`, and add
`<script defer src="/quickinfo/quickinfo.js"></script>` to your template.

## Development

```bash
npm install
npm run build
npm test            # engine, plugin, rehype pass, CLI
npm run test:e2e    # Chromium against real Sphinx and MkDocs output
```

`tests/e2e/sites` holds pages from Sphinx (Furo) and MkDocs (Material with
mkdocstrings) builds of a toy package. The e2e run builds their data with
the CLI, serves them, and drives hover, highlight, keyboard focus, and
Escape in Chromium.

The docs site in `website/` runs quickinfo through the Astro integration.
Its API reference page and hover data are generated from the JSDoc in
`src/` by `npm run gen:api`, which runs before every site build. The
screenshots above come from the site too. Regenerate them with:

```bash
cd website
npm run capture
```

## License

MIT
