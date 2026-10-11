/**
 * Theme Root override contributed by the plugin: mounts the hover runtime
 * around the whole app and pulls in the hover styles. Reaches the original
 * Root through @theme-init (the fallback theme registered first and is the
 * "initial" provider for Root; theme-classic ships no Root of its own).
 *
 * Sites where another plugin registered after this one also ships a Root
 * should mount the runtime at the layout level; see the README.
 */
import { type ReactNode } from 'react';
import OriginalRoot from '@theme-init/Root';
import ApiHoverRuntime from './ApiHoverRuntime';
import './styles.css';

export default function Root({ children }: { children: ReactNode }): ReactNode {
  return (
    <ApiHoverRuntime>
      <OriginalRoot>{children}</OriginalRoot>
    </ApiHoverRuntime>
  );
}
