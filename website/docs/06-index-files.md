---
title: Index files
description: The names JSON and info JSON schemas every quickinfo setup reads.
---

Every quickinfo setup reads two data files: the names JSON, which lists the
symbols to annotate, and the info JSON, which holds what the tooltip shows.
On [Sphinx](/sphinx) and [MkDocs](/mkdocs), `quickinfo build` writes both
from the built site. On other sites, generate them from your API's source in
a prebuild step. The default location is `quickinfo/` at the site root:
`static/quickinfo/` on Docusaurus, `public/quickinfo/` on Astro.

The names JSON lists every annotatable symbol:

```json
{
  "ids": ["mypackage.MyClass", "mypackage.MyClass.my_method"],
  "bases": { "mypackage.MySubClass": ["mypackage.MyClass"] },
  "version": "0.1.0"
}
```

`ids` are dotted symbol names. `bases` maps each class to its documented base
classes, which drives inherited-attribute lookup. `version` is appended to the
info fetch as a cache-busting query, so a new info JSON can't be served
stale from the browser cache.

The browser fetches the info JSON on first hover. It holds what the
tooltip shows:

```json
{
  "mypackage.MyClass": {
    "kind": "class",
    "url": "/api/mypackage/MyClass",
    "sig": "class MyClass(...)",
    "doc": "First line of the docstring summary."
  }
}
```

`kind` is a free-form label shown as a badge, such as `class`, `method`, or
`function`. `url` is the symbol's reference page; a relative URL resolves
against the info JSON's own URL, so one file serves every page depth. `sig`
and `doc` are optional. An entry without them shows the name and the
reference link only.
