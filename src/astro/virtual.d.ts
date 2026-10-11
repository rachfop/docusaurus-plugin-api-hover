declare module 'virtual:quickinfo/config' {
  import type { QuickinfoClientConfig } from '../browser/init';
  const config: QuickinfoClientConfig;
  export default config;
}

declare module '*.css?inline' {
  const css: string;
  export default css;
}
