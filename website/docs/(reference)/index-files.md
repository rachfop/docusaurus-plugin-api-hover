---
title: Index files
description: The names JSON and info JSON schemas every quickinfo setup reads.
---

Every quickinfo setup reads the names JSON, which lists the
symbols to annotate, and the info JSON, which holds what the tooltip shows.
On [Sphinx](/sphinx) and [MkDocs](/mkdocs), `quickinfo build` writes both
from the built site. On other sites, generate them from your API's source in
a prebuild step. The default location is `quickinfo/` at the site root:
`static/quickinfo/` on Docusaurus, `public/quickinfo/` on Astro.

The names JSON lists every annotatable symbol:

```json
{
  "ids": ["pathlib.Path", "pathlib.PurePath", "pathlib.PurePath.name"],
  "bases": { "pathlib.Path": ["pathlib.PurePath"] },
  "version": "0.1.0"
}
```

`ids` are dotted symbol names. `bases` maps each class to its documented base
classes, which drives inherited-attribute lookup: `pathlib.Path` lists
`pathlib.PurePath`, so `name` on a path resolves to
`pathlib.PurePath.name`. `version` is appended to the
info fetch as a cache-busting query, so a new info JSON can't be served
stale from the browser cache.

The browser fetches the info JSON on first hover. It holds what the
tooltip shows:

```json
{
  "pathlib.Path.cwd": {
    "kind": "class method",
    "url": "https://docs.python.org/3/library/pathlib.html#pathlib.Path.cwd",
    "sig": "classmethod cwd()",
    "doc": "Return a new path object representing the current directory."
  }
}
```

This site's data holds the same entry, which is what hovering
`pathlib.Path.cwd` shows.

`kind` is a free-form label shown as a badge, such as `class`, `method`, or
`function`. `url` is the symbol's reference page; a relative URL resolves
against the info JSON's own URL, so one file serves every page depth. `sig`
and `doc` are optional. An entry without them shows the name and the
reference link only.
