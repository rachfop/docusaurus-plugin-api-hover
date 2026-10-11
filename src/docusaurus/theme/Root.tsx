/**
 * Theme Root override contributed by the plugin: starts the hover runtime
 * and pulls in the hover styles. Reaches the original Root through
 * @theme-init (the fallback theme registered first and is the "initial"
 * provider for Root; theme-classic ships no Root of its own).
 *
 * Sites where another plugin registered after this one also ships a Root
 * mount `quickinfo/docusaurus/runtime` themselves; see the README.
 */
import { type ReactNode } from 'react';
import OriginalRoot from '@theme-init/Root';
import QuickinfoRuntime from '../runtime';

export default function Root({ children }: { children: ReactNode }): ReactNode {
  return (
    <QuickinfoRuntime>
      <OriginalRoot>{children}</OriginalRoot>
    </QuickinfoRuntime>
  );
}
