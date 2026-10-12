---
title: Introduction
description: Editor-style API hovers for Docusaurus, Astro, Sphinx, MkDocs, and any other static site generator.
---

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

![Hovering CPU in a MAX code example shows a tooltip with the CLASS badge, the full name max.driver.CPU, its signature, its doc summary, and a link to its reference page.](/hover-light.png)

Resolution is snippet-aware. Hover the names in this example, which uses
real data from the MAX Python API:

```python
from max import driver

device = driver.Accelerator()
print(device.id)
cpu = driver.CPU()
```

`driver.CPU` resolves to `max.driver.CPU` through the import. `device.id`
resolves to `max.driver.Device.id`: `device` holds an `Accelerator`, which
inherits `id` from its documented base class, `Device`.

## Set up your site

[Get started](/get-started) has one prompt that sets quickinfo up through
your LLM coding assistant. To set it up by hand, follow the integration page
for your site generator:

- [Docusaurus](/docusaurus): a plugin annotates code blocks and prose at
  build time.
- [Astro](/astro) and [Blume](/blume): an integration annotates in the
  browser. The hovers on this site run that way.
- [Sphinx](/sphinx) and [MkDocs](/mkdocs): the `quickinfo build` command
  turns a built site's `objects.inv` and API pages into hover data, and one
  script tag does the rest.
- [Any other static site generator](/script-tag): the same script tag,
  with symbol data you generate.

Every setup reads the names JSON and info JSON. [Index files](/index-files)
defines their schemas, and [symbol resolution](/resolution) covers the
matching rules. The [API reference](/api-reference) documents every export
and option.
