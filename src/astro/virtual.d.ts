declare module 'virtual:api-hover/config' {
  import type { ApiHoverClientConfig } from './runtime';
  const config: ApiHoverClientConfig;
  export default config;
}

declare module '*.css?inline' {
  const css: string;
  export default css;
}
