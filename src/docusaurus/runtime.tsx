/**
 * Mounts the shared browser hover runtime on a Docusaurus site. Code
 * blocks and prose mentions already carry `data-api-id` from the build
 * (theme components and the rehype pass), so the runtime only attaches
 * its document-level listeners; nothing here re-renders.
 */
import { useEffect, type ReactNode } from 'react';
import { startHover } from '../browser/hover';
import { getInfoVersion, siteConfig } from './site-data';
import 'quickinfo/styles';

/**
 * Starts the hover runtime and loads its styles. The plugin's `Root`
 * mounts it; mount it yourself (around your layout) only when another
 * plugin's `Root` replaces this one.
 *
 * @param children What to render inside; the runtime renders nothing of
 *   its own.
 */
export default function QuickinfoRuntime({ children }: { children?: ReactNode }): ReactNode {
  useEffect(() => {
    startHover({ infoUrl: siteConfig().infoUrl, version: getInfoVersion() });
  }, []);
  return <>{children}</>;
}
