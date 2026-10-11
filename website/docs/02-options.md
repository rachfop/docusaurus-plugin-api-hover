---
title: Options
description: Every setting the plugin entry and the rehype pass take.
---

Set [`dataFile`](/index-files) to the names JSON your prebuild generates. It
is the one required option; the rest have defaults:

| Option           | Default                     | What it does                                |
| ---------------- | --------------------------- | ------------------------------------------- |
| `dataFile`       | none                        | Path to the generated names JSON.           |
| `infoUrl`        | `/data/api-hover-info.json` | URL the browser fetches the info JSON from. |
| `preferPrefixes` | `[]`                        | Id prefixes that win short-name collisions. |
| `languages`      | `['python']`                | Languages to annotate. Built in: `python`.  |

The rehype pass takes `dataFile`, `preferPrefixes`, and `apiBasePath`
(default `/api`). `apiBasePath` sets which link hrefs count as links to API
pages.
