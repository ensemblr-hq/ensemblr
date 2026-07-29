import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type { CSSProperties, ReactNode } from 'react';
import { useMemo } from 'react';
import type { BundledLanguage } from 'shiki';
import { ScrollBar } from '@/renderer/components/ui/scroll-area';
import { useHighlightedCode } from '@/renderer/hooks/code-surface/use-highlighted-code';
import { cn } from '@/renderer/lib/utils';
import type { TokenizedCode } from '@/renderer/types/code';
import { BlockControls } from './block-controls';
import { CopyResponseButton } from './copy-response-button';

/**
 * Scroll shell every code body sits in. Wrap rows of pre-formatted content in
 * it and the shared chrome comes for free: the app's code surface, a 20rem cap,
 * custom scrollbars on both axes, and an optional copy control.
 *
 * Background, border, and default ink come from the app's `code` tokens and so
 * follow light/dark mode; only the syntax colours inside come from the theme
 * picked in Settings → Appearance → Code theme. A panel therefore never paints
 * itself light inside a dark window because a light Shiki theme was chosen.
 *
 * Children must not wrap — the viewport scrolls sideways rather than reflowing.
 * For payloads that should wrap, use `ToolPanel` instead.
 *
 * A surface that carries the copy control also carries a floor on its height:
 * a single-line body is shorter than the control itself, which would otherwise
 * be clipped by the rounded overflow.
 */
export function CodeSurface({
	children,
	copyText,
}: {
	children: ReactNode;
	/** Shows a hover-revealed copy button holding this text. */
	copyText?: string;
}) {
	return (
		<ScrollAreaPrimitive.Root
			className={cn(
				'group/block relative overflow-hidden rounded-md border border-code-border bg-code text-code-foreground',
				copyText !== undefined && 'flex min-h-10 flex-col justify-center',
			)}
			type='scroll'
		>
			<ScrollAreaPrimitive.Viewport className='max-h-80 w-full overscroll-contain'>
				<div className='min-w-max py-1 font-mono text-xs leading-5'>
					{children}
				</div>
			</ScrollAreaPrimitive.Viewport>
			{copyText === undefined ? null : (
				<BlockControls>
					<CopyResponseButton label='Copy code' text={copyText} />
				</BlockControls>
			)}
			<ScrollBar orientation='vertical' />
			<ScrollBar orientation='horizontal' />
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	);
}

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
 * Syntax-highlighted code on the shared surface — the block used for tool
 * output, file reads, and fenced code in assistant answers alike.
 *
 * Smaller type and tighter padding than the standalone `CodeBlock`, which is
 * tuned for settings previews rather than a chat row. Pass `startLine` to
 * number the gutter from a real file offset; omit it for bare command output.
 * `language` is a Shiki grammar — use `'text'` to leave content uncoloured.
 */
export function CodePanel({
	code,
	copyable = false,
	language,
	startLine,
}: {
	code: string;
	/** Reveals a copy button in the top-right corner on hover. */
	copyable?: boolean;
	language: BundledLanguage;
	startLine?: number | null;
}) {
	const tokenized = useHighlightedCode(code, language);
	const textLines = useMemo(() => code.split('\n'), [code]);
	const gutterWidth = useMemo(
		() =>
			startLine === undefined || startLine === null
				? undefined
				: `${String(startLine + textLines.length).length}ch`,
		[startLine, textLines.length],
	);

	return (
		<CodeSurface copyText={copyable ? code : undefined}>
			{textLines.map((text, lineIndex) => (
				<div className='flex' key={`line-${lineIndex}`}>
					{gutterWidth ? (
						<span
							className='box-content shrink-0 select-none border-code-border border-r pr-2 pl-3 text-right tabular-nums opacity-40'
							style={{ width: gutterWidth }}
						>
							{(startLine ?? 0) + lineIndex}
						</span>
					) : null}
					<span
						className={cn('whitespace-pre pr-4', gutterWidth ? 'pl-2' : 'pl-3')}
					>
						<CodeLineTokens
							fallback={text}
							lineKey={`line-${lineIndex}`}
							tokens={tokenized?.tokens[lineIndex] ?? null}
						/>
					</span>
				</div>
			))}
		</CodeSurface>
	);
}
