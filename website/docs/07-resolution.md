---
title: How names resolve
description: The matching rules that map identifiers in code and prose to indexed symbols.
---

quickinfo resolves each identifier in a Python snippet against the index,
using the snippet's bindings:

- Exact dotted id: `mypackage.MyClass` resolves when it's in the index.
- Import aliases: after `from mypackage import mod`, the name `mod.Thing`
  resolves to `mypackage.mod.Thing`.
- Unique short names: `MyClass` resolves when one indexed id ends with it
  and no other does.
- Inferred local types: after `device = Accelerator()`, the attribute
  `device.id` resolves to the `id` attribute, including attributes inherited
  from documented base classes.

Names the snippet binds itself stay plain. A local variable called `buffer`
is your variable, never the `Buffer` class, even when the short name would
match. A name that could match more than one symbol also stays plain.

`preferPrefixes` breaks those collisions: the id carrying a listed prefix
wins. Use it when the index mixes your symbols with ids from another source,
such as the Python standard library.
