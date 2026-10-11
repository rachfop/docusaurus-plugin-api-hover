---
title: Sites that ship their own Root
description: Mount the hover runtime yourself when another plugin provides the Root.
---

Docusaurus renders the Root of the last plugin that provides one. If another
plugin in your `plugins` array ships a `Root` and is registered after this
one, its Root wins. This plugin's Root, which mounts the hover runtime, never
runs.

Register this plugin first, then mount the runtime at the layout level:

```js
import ApiHoverRuntime from 'docusaurus-plugin-api-hover/runtime';
import 'docusaurus-plugin-api-hover/styles';

// In src/theme/Layout/Provider/index.tsx:
// composeProviders([..., ApiHoverRuntime])
```

The `styles` import supplies the hover styling; the runtime component ships
without a stylesheet of its own.
