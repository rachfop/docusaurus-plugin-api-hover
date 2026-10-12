---
title: Symbol resolution
description: The matching rules that map identifiers in code and prose to indexed symbols.
---

quickinfo resolves each identifier in a Python snippet against the index,
using the snippet's own imports and bindings. The examples on this page use
real symbols from the MAX Python API, so every rule is live: hover the
underlined names.

## Exact dotted ids

A full dotted name resolves when it's in the index, in prose and in code:
`max.graph.Graph` names the class directly.

```python
import max.graph

graph = max.graph.Graph("demo")
```

## Import aliases

An import binds a local name to a module or symbol, and names built on it
resolve through the import:

```python
from max.graph import ops
from max.dtype import DType

y = ops.relu(x)
dtype = DType.float32
```

`ops.relu` resolves to `max.graph.ops.relu` and `DType.float32` to
`max.dtype.DType.float32`.

## Unique short names

A bare name resolves when one indexed id ends with it and no other does:
`TensorType` names `max.graph.TensorType`. A name that matches more than one
symbol stays plain: `CPU` alone could be `max.driver.CPU` or
`max.graph.DeviceRef.CPU`, so it gets no hover until an import or a dotted
name decides it.

## Inferred local types

A local assigned from a constructor call, or bound by `with ... as`, takes
the class as its type. Attributes on it resolve through the class, and
through its documented base classes when the class doesn't define them:

```python
from max import driver
from max.graph import Graph

device = driver.Accelerator()
print(device.id)

with Graph("demo") as graph:
    graph.output(graph.inputs[0])
```

`device.id` resolves to `max.driver.Device.id`: `Accelerator` inherits `id`
from `Device`. `graph.output` and `graph.inputs` resolve on `Graph`.

## Names the snippet binds

A name the snippet assigns, takes as a parameter, or binds with `as` or
`for` is the snippet's own variable. It stays plain even when it matches a
unique short name:

```python
inputs = [1, 2, 3]
print(len(inputs))
```

Here `inputs` is a list. In prose, `inputs` still names the `Graph`
property.

## Preferred prefixes

When the index mixes your symbols with ids from another source, such as the
Python standard library, the `preferPrefixes` option breaks short-name
collisions: the id carrying a listed prefix wins. With
`preferPrefixes: ['max.']`, a bare `Buffer` names `max.driver.Buffer` even
when the index also holds `collections.abc.Buffer`.
