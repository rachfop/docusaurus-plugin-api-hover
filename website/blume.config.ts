import quickinfo from 'quickinfo/astro';
import { defineConfig } from 'blume';

export default defineConfig({
  title: 'quickinfo',
  description: 'IDE-style API hovers for docs sites.',
  github: {
    owner: 'rachfop',
    repo: 'quickinfo',
    dir: 'website',
  },
  lastModified: 'git',
  deployment: {
    site: 'https://rachfop.github.io',
    base: '/quickinfo',
  },
  integrations: [
    // Serves public/quickinfo/names.json and info.json; the deploy base
    // path is prefixed automatically.
    quickinfo(),
  ],
});
