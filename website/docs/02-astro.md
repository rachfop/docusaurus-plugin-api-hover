---
title: Set up Astro and Blume
description: Add the quickinfo integration to an Astro or Blume site.
---

On Astro sites, Blume and Starlight included, quickinfo annotates in the
browser. The integration injects one script on every page, which fetches the
names JSON, marks code blocks and prose mentions, and runs the tooltip. It
reads the rendered HTML, so it works with any Markdown processor and behaves
the same in dev and production.

## Add the data files

Generate the [names JSON and info JSON](/index-files) and write both to
`public/quickinfo/`. The integration fetches `/quickinfo/names.json` and
`/quickinfo/info.json` by default, under the site's `base` path.

## Add the integration

Add `quickinfo()` to the integrations:

```ts
import quickinfo from 'quickinfo/astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [quickinfo()],
});
```

On Blume, add it to `integrations` in `blume.config.ts` the same way. This
site works that way: every hover on it comes from the integration.

To serve the data files from somewhere else, pass
[`namesUrl` and `infoUrl`](/api-reference#quickinfoastrooptions). A
root-relative URL resolves under the site's `base` path.

The integration re-annotates after Astro view transitions, so hovers keep
working across client-side navigation.
