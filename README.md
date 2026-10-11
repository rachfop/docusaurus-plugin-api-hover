# quickinfo

Give your API docs the hovers an editor shows. Identifiers that reference a
documented symbol get a dotted underline, in code blocks and in prose. Hover
one and every other mention of the symbol on the page lights up, and a
tooltip shows its kind, full name, signature, docstring summary, and a link
to its reference page. Keyboard focus opens the same tooltip, and Escape
closes it.

quickinfo runs on Docusaurus, Astro and Blume, Sphinx, MkDocs, and any other
static site.

Resolution is snippet-aware. After `from mypackage import mod`, the name
`mod.Thing` resolves to `mypackage.mod.Thing`. After `device = Accelerator()`,
the attribute `device.id` resolves to the `id` attribute of the class,
following documented base classes when the class itself doesn't define it.

Hovers read a names JSON listing the symbols, and an info
JSON with signatures and doc summaries that the browser fetches on first
hover. On Sphinx and MkDocs, `quickinfo build` writes both from the built
site.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/hover-dark.png">
  <img src="media/hover-light.png" alt="Hovering the buildIndex mention on the plugin's own API reference page shows a tooltip with its kind badge, full name, signature, doc summary, and a reference-page link.">
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

**Any other static site.** Copy the script next to your data files with
`npx quickinfo assets <dir>`, and add
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
