import { defineConfig } from 'blume';

export default defineConfig({
  title: 'docusaurus-plugin-api-hover',
  description: 'IDE-style API hovers for Docusaurus docs.',
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
});
