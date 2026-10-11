---
title: Introduction
description: IDE-style API hovers for Docusaurus docs.
---

Give your API docs IDE-style hovers. Identifiers that reference a documented
symbol get a dotted underline, in code blocks and in prose. Hover one and
every other mention of the symbol on the page lights up. A tooltip shows its
kind, full name, signature, and a link to its reference page.

![Hovering the buildApiHoverIndex mention on this site's API reference page shows a tooltip with the FUNCTION badge, the full name, its signature, its doc summary, and a link to the reference page.](/hover-light.png)

Resolution is snippet-aware. After `from mypackage import mod`, the name
`mod.Thing` resolves to `mypackage.mod.Thing`. After `device = Accelerator()`,
the attribute `device.id` resolves to the `id` attribute of the class,
following documented base classes when the class itself doesn't define it.

You supply the symbol data: a names JSON generated at build time, and an
info JSON with signatures and doc summaries that the browser fetches on
first hover. Everything else ships in the plugin.

## Install

```bash
npm install docusaurus-plugin-api-hover
```

## Where to go next

The [quick start](/quickstart) wires the plugin into a Docusaurus site.
[Options](/options) lists every setting, and [index files](/index-files)
define the names JSON and info JSON schemas. [How names resolve](/resolution)
covers the matching rules, including collisions and snippet bindings. The
[API reference](/api-reference) documents every export the plugin ships;
the hovers on this very site run through its Astro integration.
