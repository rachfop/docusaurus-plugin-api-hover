---
title: Symbol resolution
description: The matching rules that map identifiers in code and prose to indexed symbols.
---

quickinfo resolves each identifier in a Python snippet against the index,
using the snippet's own imports and bindings. The examples on this page use
real symbols from the Python standard library, so every rule is live: hover
the underlined names.

## Exact dotted ids

A full dotted name resolves when it's in the index, in prose and in code:
`pathlib.Path` names the class directly.

```python
import pathlib

config = pathlib.Path("app.toml")
```

## Import aliases

An import binds a local name to a module or symbol, and names built on it
resolve through the import:

```python
from json import dumps
from pathlib import Path

text = dumps({"ok": True})
here = Path.cwd()
```

`dumps` resolves to `json.dumps`, and `Path.cwd` to `pathlib.Path.cwd`.

## Unique short names

A bare name resolves when one indexed id ends with it and no other does:
`OrderedDict` names `collections.OrderedDict`. A name that matches more than
one symbol stays plain: `Queue` alone could be `queue.Queue` or
`multiprocessing.Queue`, so it gets no hover until an import or a dotted
name decides it.

## Inferred local types

A local assigned from a constructor call, or bound by `with ... as`, takes
the class as its type. Attributes on it resolve through the class, and
through its documented base classes when the class doesn't define them:

```python
from pathlib import Path
import zipfile

config = Path("app.toml")
print(config.name)

with zipfile.ZipFile("bundle.zip") as archive:
    print(archive.namelist())
```

`config.name` resolves to `pathlib.PurePath.name`: `Path` inherits `name`
from `PurePath`. `archive.namelist` resolves on `ZipFile`.

## Names the snippet binds

A name the snippet assigns, takes as a parameter, or binds with `as` or
`for` is the snippet's own variable. It stays plain even when it matches a
unique short name:

```python
name = "app.toml"
print(name)
```

Here `name` is a string. In prose, `name` still names the `PurePath`
property.

## Preferred prefixes

When the index mixes ids from more than one source, such as your package
and the Python standard library, the `preferPrefixes` option breaks
short-name collisions: the id carrying a listed prefix wins. With
`preferPrefixes: ['queue.']`, a bare `Queue` names `queue.Queue` even
when the index also holds `multiprocessing.Queue`.
