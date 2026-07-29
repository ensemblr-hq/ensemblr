'use client';

import type { CSSProperties, HTMLAttributes } from 'react';
import { createContext, memo, useEffect, useMemo, useState } from 'react';
import type { BundledLanguage, ThemedToken } from 'shiki';
import { highlightCode } from '@/renderer/lib/code/highlighter';
import { cn } from '@/renderer/lib/utils';
import { useResolvedCodeTheme } from '@/renderer/state/preferences';
import type { TokenizedCode } from '@/renderer/types/code';

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline
/**
 * Whether a Shiki token's font-style bitflags include the italic bit.
 * @param fontStyle - Shiki token font-style bitflags
 * @returns A truthy value when the italic bit is set
 */
// oxlint-disable-next-line eslint(no-bitwise)
const isItalic = (fontStyle: number | undefined) => fontStyle && fontStyle & 1;
/**
 * Whether a Shiki token's font-style bitflags include the bold bit.
 * @param fontStyle - Shiki token font-style bitflags
 * @returns A truthy value when the bold bit is set
 */
// oxlint-disable-next-line eslint(no-bitwise)
const isBold = (fontStyle: number | undefined) => fontStyle && fontStyle & 2;
/**
 * Whether a Shiki token's font-style bitflags include the underline bit.
 * @param fontStyle - Shiki token font-style bitflags
 * @returns A truthy value when the underline bit is set
 */
const isUnderline = (fontStyle: number | undefined) =>
	// oxlint-disable-next-line eslint(no-bitwise)
	fontStyle && fontStyle & 4;

// Transform tokens to include pre-computed keys to avoid noArrayIndexKey lint
/** A Shiki token paired with a stable React key for list rendering. */
interface KeyedToken {
	token: ThemedToken;
	key: string;
}
/** A source line of keyed Shiki tokens, itself carrying a stable React key. */
interface KeyedLine {
	tokens: KeyedToken[];
	key: string;
}

/**
 * Attach stable React keys to every Shiki line and token for list rendering.
 * @param lines - Tokenized lines produced by Shiki
 * @returns The lines and tokens wrapped with deterministic keys
 */
const addKeysToTokens = (lines: ThemedToken[][]): KeyedLine[] =>
	lines.map((line, lineIdx) => ({
		key: `line-${lineIdx}`,
		tokens: line.map((token, tokenIdx) => ({
			key: `line-${lineIdx}-${tokenIdx}`,
			token,
		})),
	}));

// Token rendering component
/** Renders a single syntax-highlighted token as a styled span. */
const TokenSpan = ({ token }: { token: ThemedToken }) => (
	<span
		style={
			{
				backgroundColor: token.bgColor,
				color: token.color,
				fontStyle: isItalic(token.fontStyle) ? 'italic' : undefined,
				fontWeight: isBold(token.fontStyle) ? 'bold' : undefined,
				textDecoration: isUnderline(token.fontStyle) ? 'underline' : undefined,
				...token.htmlStyle,
			} as CSSProperties
		}
	>
		{token.content}
	</span>
);

// Line number styles using CSS counters
const LINE_NUMBER_CLASSES = cn(
	'before:content-[counter(line)]',
	'before:inline-block',
	'before:[counter-increment:line]',
	'before:w-8',
	'before:mr-4',
	'before:text-right',
	'before:text-muted-foreground/50',
	'before:font-mono',
	'before:select-none',
);

// A wrapped line must clear its own gutter, so the padding matches the line
// number's `before:w-8` plus its `before:mr-4` and the negative indent pulls
// only the first visual line back over it.
const WRAPPED_LINE_NUMBER_CLASSES = '-indent-12 pl-12';

// Line rendering component
/** Renders one code line as a row of token spans, optionally with a CSS-counter line number. */
const LineSpan = ({
	keyedLine,
	showLineNumbers,
	wrapLines,
}: {
	keyedLine: KeyedLine;
	showLineNumbers: boolean;
	wrapLines: boolean;
}) => (
	<span
		className={cn(
			'block',
			showLineNumbers && LINE_NUMBER_CLASSES,
			showLineNumbers && wrapLines && WRAPPED_LINE_NUMBER_CLASSES,
		)}
	>
		{keyedLine.tokens.length === 0
			? '\n'
			: keyedLine.tokens.map(({ token, key }) => (
					<TokenSpan key={key} token={token} />
				))}
	</span>
);

// Types
/** Props for the CodeBlock component: source code, its language, and optional line-number and wrap toggles. */
type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
	code: string;
	language: BundledLanguage;
	showLineNumbers?: boolean;
	wrapLines?: boolean;
};

/** Context value exposing the raw source code to CodeBlock subcomponents. */
interface CodeBlockContextType {
	code: string;
}

// Context
const CodeBlockContext = createContext<CodeBlockContextType>({
	code: '',
});

// Create raw tokens for immediate display while highlighting loads
/**
 * Build unstyled tokens so code renders immediately before Shiki finishes highlighting.
 * @param code - Source code to wrap as raw tokens
 * @returns Tokenized code with inherited colors and one token per line
 */
const createRawTokens = (code: string): TokenizedCode => ({
	tokens: code.split('\n').map((line) =>
		line === ''
			? []
			: [
					{
						color: 'inherit',
						content: line,
					} as ThemedToken,
				],
	),
});

/**
 * Renders the highlighted token grid inside a styled pre/code block; memoized
 * against its tokens and options.
 *
 * The surface comes from the app's `code` tokens rather than the Shiki theme's
 * own `bg`/`fg`, so a block stays dark in dark mode and light in light mode
 * whichever theme Settings → Appearance → Code theme is set to.
 *
 * Unwrapped, the block sizes itself to its widest line (`w-max`) instead of to
 * its scroll container: a plain block would paint its background only across the
 * viewport, leaving everything past that point bare once the reader scrolls
 * sideways. `min-w-full` keeps a short file filling the container.
 */
const CodeBlockBody = memo(
	({
		tokenized,
		showLineNumbers,
		wrapLines,
	}: {
		tokenized: TokenizedCode;
		showLineNumbers: boolean;
		wrapLines: boolean;
	}) => {
		const keyedLines = useMemo(
			() => addKeysToTokens(tokenized.tokens),
			[tokenized.tokens],
		);

		return (
			<pre
				className={cn(
					'm-0 bg-code p-4 text-code-foreground text-sm',
					wrapLines ? 'whitespace-pre-wrap break-words' : 'w-max min-w-full',
				)}
			>
				<code
					className={cn(
						'font-mono text-sm',
						showLineNumbers &&
							'[counter-increment:line_0] [counter-reset:line]',
					)}
				>
					{keyedLines.map((keyedLine) => (
						<LineSpan
							key={keyedLine.key}
							keyedLine={keyedLine}
							showLineNumbers={showLineNumbers}
							wrapLines={wrapLines}
						/>
					))}
				</code>
			</pre>
		);
	},
	(prevProps, nextProps) =>
		prevProps.tokenized === nextProps.tokenized &&
		prevProps.showLineNumbers === nextProps.showLineNumbers &&
		prevProps.wrapLines === nextProps.wrapLines,
);

CodeBlockBody.displayName = 'CodeBlockBody';

/** Inputs for {@link CodeBlockContent}: the source to highlight and how to lay it out. */
interface CodeBlockContentProps {
	/** Extra classes for the scroll container, e.g. `min-h-0 flex-1` inside a flex column. */
	className?: string;
	code: string;
	language: BundledLanguage;
	showLineNumbers?: boolean;
	wrapLines?: boolean;
}

/**
 * Highlights and renders code for a language, showing raw tokens immediately and
 * swapping in Shiki output once it loads.
 *
 * Scrolls its own overflow by default. A parent that is already a scroll
 * container should pass `className='min-h-0 flex-1'` and drop its own wrapper,
 * so the horizontal scrollbar stays pinned to the viewport instead of sitting
 * below the last line of a long file.
 */
export const CodeBlockContent = ({
	className,
	code,
	language,
	showLineNumbers = false,
	wrapLines = false,
}: CodeBlockContentProps) => {
	// Picked syntax theme (Settings → Appearance → Code theme), in the app's
	// current polarity.
	const codeTheme = useResolvedCodeTheme();

	// Memoized raw tokens for immediate display
	const rawTokens = useMemo(() => createRawTokens(code), [code]);

	// Synchronous cache lookup — avoids setState in effect for cached results
	const syncTokens = useMemo(
		() => highlightCode(code, language, codeTheme) ?? rawTokens,
		[code, language, codeTheme, rawTokens],
	);

	// Async highlighting result (populated after shiki loads)
	const [asyncTokens, setAsyncTokens] = useState<TokenizedCode | null>(null);
	const [asyncKey, setAsyncKey] = useState({
		code,
		language,
		theme: codeTheme,
	});

	// Invalidate stale async tokens synchronously during render
	if (
		asyncKey.code !== code ||
		asyncKey.language !== language ||
		asyncKey.theme !== codeTheme
	) {
		setAsyncKey({ code, language, theme: codeTheme });
		setAsyncTokens(null);
	}

	useEffect(() => {
		let cancelled = false;

		highlightCode(code, language, codeTheme, (result) => {
			if (!cancelled) {
				setAsyncTokens(result);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [code, language, codeTheme]);

	const tokenized = asyncTokens ?? syncTokens;

	return (
		<div className={cn('relative overflow-auto', className)}>
			<CodeBlockBody
				showLineNumbers={showLineNumbers}
				tokenized={tokenized}
				wrapLines={wrapLines}
			/>
		</div>
	);
};

/** Outer bordered container for a code block, tagged with its language and tuned for content-visibility. */
const CodeBlockContainer = ({
	className,
	language,
	style,
	...props
}: HTMLAttributes<HTMLDivElement> & { language: string }) => (
	<div
		className={cn(
			'group relative w-full overflow-hidden rounded-md border bg-background text-foreground',
			className,
		)}
		data-language={language}
		style={{
			containIntrinsicSize: 'auto 200px',
			contentVisibility: 'auto',
			...style,
		}}
		{...props}
	/>
);

/** Public code block that provides code context and composes the container, optional children, and highlighted content. */
export const CodeBlock = ({
	code,
	language,
	showLineNumbers = false,
	wrapLines = false,
	className,
	children,
	...props
}: CodeBlockProps) => {
	const contextValue = useMemo(() => ({ code }), [code]);

	return (
		<CodeBlockContext.Provider value={contextValue}>
			<CodeBlockContainer className={className} language={language} {...props}>
				{children}
				<CodeBlockContent
					code={code}
					language={language}
					showLineNumbers={showLineNumbers}
					wrapLines={wrapLines}
				/>
			</CodeBlockContainer>
		</CodeBlockContext.Provider>
	);
};
