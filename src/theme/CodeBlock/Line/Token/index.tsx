/**
 * Pass-through token renderer that adds `data-api-id` to tokens annotated
 * by the Line override, so the hover runtime can highlight every instance
 * of the same symbol on the page and show its signature in a tooltip.
 *
 * Mirrors theme-classic's Token (a pass-through spreading props onto a
 * span); written inline rather than delegating so the annotation
 * attributes land on the same element with no extra render layer.
 */
import { type ReactNode } from 'react';
import clsx from 'clsx';
import type { PrismToken } from '../../../../lib/annotate';

type TokenWithApiId = PrismToken & { apiId?: string };

interface TokenProps {
  line?: unknown;
  token: TokenWithApiId | undefined;
  className?: string;
  [key: string]: unknown;
}

export default function CodeBlockLineToken({
  line: _line,
  token,
  className,
  ...props
}: TokenProps): ReactNode {
  const apiId = token?.apiId;
  return (
    <span
      {...props}
      className={clsx(className, apiId && 'api-hover-token')}
      data-api-id={apiId || undefined}
    />
  );
}
