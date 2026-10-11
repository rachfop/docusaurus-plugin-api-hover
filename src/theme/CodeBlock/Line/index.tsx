/**
 * Line renderer override contributed by the plugin: annotates the line's
 * tokens against the API index before handing the line to the original
 * Line. Annotation resolves identifiers with real snippet context (import
 * aliases, inferred local types, shadowing binds), so every Line must see
 * the whole code block, available from the code block context.
 */
import { useMemo, type ReactNode } from 'react';
import OriginalLine from '@theme-init/CodeBlock/Line';
import { useCodeBlockContext } from '@docusaurus/theme-common/internal';
import { annotateLines, type PrismToken } from '../../../lib/annotate';

interface LineProps {
  line: PrismToken[];
  classNames?: string[];
  showLineNumbers?: boolean;
  getLineProps: (input: Record<string, unknown>) => Record<string, unknown>;
  getTokenProps: (input: { token: unknown; key?: number }) => Record<string, unknown>;
  [key: string]: unknown;
}

export default function CodeBlockLine(props: LineProps): ReactNode {
  const { metadata } = useCodeBlockContext();
  const annotatedLine = useMemo(
    () => annotateLines(props.line, metadata.code, metadata.language),
    [props.line, metadata.code, metadata.language],
  );
  return <OriginalLine {...props} line={annotatedLine} />;
}
