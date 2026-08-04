import type { CSSProperties } from 'react';
import { codeGutterDigits } from '@/renderer/lib/code/gutter';
import { cn } from '@/renderer/lib/utils';
import type { TokenizedCode } from '@/renderer/types/code';
import { CODE_GUTTER_CLASSES, CODE_GUTTER_DIVIDER_CLASSES } from './code-style';

/**
 * Renders one Shiki-tokenized line as coloured spans. Highlighting resolves
 * asynchronously, so `fallback` carries the raw text — it renders unstyled on
 * the first paint and swaps in colour once the grammar loads, with no reflow.
 */
export function CodeLineTokens({
	fallback,
	lineKey,
	tokens,
}: {
	fallback: string;
	lineKey: string;
	tokens: TokenizedCode['tokens'][number] | null;
}) {
	if (!tokens) {
		return <>{fallback}</>;
	}
	return (
		<>
			{tokens.map((token, tokenIndex) => (
				<span
					key={`${lineKey}-token-${tokenIndex}`}
					style={{ color: token.color, ...token.htmlStyle } as CSSProperties}
				>
					{token.content}
				</span>
			))}
		</>
	);
}

/**
 * One line-number cell on a code surface. Sizing itself from the surface's
 * highest line number rather than from its own value keeps every row's content
 * on the same offset, and hands the caller the same column the diff viewer's
 * table draws.
 */
export function CodeGutter({
	divider = false,
	maxLineNumber,
	tint,
	value,
}: {
	/** Draws the hairline separating the gutter from the code beside it. */
	divider?: boolean;
	maxLineNumber: number;
	/** Change tint for a diff row, from `DIFF_GUTTER_TINT`. */
	tint?: string;
	value: number | string;
}) {
	return (
		<span
			className={cn(
				CODE_GUTTER_CLASSES,
				divider && CODE_GUTTER_DIVIDER_CLASSES,
				tint,
			)}
			style={{ width: `${codeGutterDigits(maxLineNumber)}ch` }}
		>
			{value}
		</span>
	);
}
