---
title: Introduction
description: IDE-style API hovers for Docusaurus, Astro, Sphinx, MkDocs, and any static docs site.
---

quickinfo gives your API docs the hovers an editor shows. Identifiers that
reference a documented symbol get a dotted underline, in code blocks and in
prose. Hover one and every other mention of the symbol on the page lights
up, and a tooltip shows its kind, full name, signature, docstring summary,
and a link to its reference page. Keyboard focus opens the same tooltip, and
Escape closes it.

![Hovering the buildIndex mention on this site's API reference page shows a tooltip with the FUNCTION badge, the full name, its signature, its doc summary, and a link to the reference page.](/hover-light.png)

Resolution is snippet-aware. After `from mypackage import mod`, the name
`mod.Thing` resolves to `mypackage.mod.Thing`. After `device = Accelerator()`,
the attribute `device.id` resolves to the `id` attribute of the class,
following documented base classes when the class itself doesn't define it.

## Install

```bash
npm install quickinfo
```

## Set up your site

Each site generator has its own setup page:

- [Docusaurus](/docusaurus): a plugin annotates code blocks and prose at
  build time.
- [Astro and Blume](/astro): an integration annotates in the browser. The
  hovers on this site run that way.
- [Sphinx](/sphinx) and [MkDocs](/mkdocs): the `quickinfo build` command
  turns a built site's `objects.inv` and API pages into hover data, and one
  script tag does the rest.
- [Any other static site](/script-tag): the same script tag, with symbol
  data you generate.

Every setup reads two data files. [Index files](/index-files) defines their
schemas, and [how names resolve](/resolution) covers the matching rules. The
[API reference](/api-reference) documents every export and option.
