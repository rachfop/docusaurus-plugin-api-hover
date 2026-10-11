import apiHover from 'docusaurus-plugin-api-hover/astro';
import { defineConfig } from 'blume';

export default defineConfig({
  title: 'docusaurus-plugin-api-hover',
  description: 'IDE-style API hovers for docs sites.',
  github: {
    owner: 'rachfop',
    repo: 'docusaurus-plugin-api-hover',
    dir: 'website',
  },
  lastModified: 'git',
  deployment: {
    site: 'https://rachfop.github.io',
    base: '/docusaurus-plugin-api-hover',
  },
  integrations: [
    apiHover({
      namesUrl: '/docusaurus-plugin-api-hover/api-hover/names.json',
      infoUrl: '/docusaurus-plugin-api-hover/api-hover/info.json',
    }),
  ],
});
