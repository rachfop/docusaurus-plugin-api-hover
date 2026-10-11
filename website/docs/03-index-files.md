---
title: Index files
description: The names JSON and info JSON schemas the plugin consumes.
---

The names JSON (`dataFile`) lists every annotatable symbol:

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

The info JSON (served at `infoUrl`) holds what the tooltip shows:

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
`function`. `sig` and `doc` are optional. An entry without them shows the name
and the reference link only.
