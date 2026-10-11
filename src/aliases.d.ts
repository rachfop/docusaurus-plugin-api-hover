/**
 * Docusaurus theme aliases (`@theme-init/*`) are resolved by the site's
 * bundler at build time, not by tsc. theme-classic's published .d.ts files
 * reference unshipped types, so declare the aliases we consume ambiently
 * with their runtime shapes (theme-classic's Root/Line/Token).
 */
declare module '@theme-init/Root' {
  import { type ReactNode } from 'react';
  export default function Root({ children }: { children: ReactNode }): ReactNode;
}

declare module '@theme-init/CodeBlock/Line' {
  import { type ReactNode } from 'react';
  export default function CodeBlockLine(props: Record<string, unknown>): ReactNode;
}

declare module '@theme-init/CodeBlock/Line/Token' {
  import { type ReactNode } from 'react';
  export default function CodeBlockLineToken(props: Record<string, unknown>): ReactNode;
}
