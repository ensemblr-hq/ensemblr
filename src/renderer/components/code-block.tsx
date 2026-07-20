'use client';

import { useAtomValue } from 'jotai';
import type { CSSProperties, HTMLAttributes } from 'react';
import { createContext, memo, useEffect, useMemo, useState } from 'react';
import type {
	BundledLanguage,
	BundledTheme,
	HighlighterGeneric,
	ThemedToken,
} from 'shiki';
import { createHighlighter } from 'shiki';
import { cn } from '@/renderer/lib/utils';
import { codeThemeAtom } from '@/renderer/state/preferences';

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
		className='dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]'
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
	'block',
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

// Line rendering component
/** Renders one code line as a row of token spans, optionally with a CSS-counter line number. */
const LineSpan = ({
	keyedLine,
	showLineNumbers,
}: {
	keyedLine: KeyedLine;
	showLineNumbers: boolean;
}) => (
	<span className={showLineNumbers ? LINE_NUMBER_CLASSES : 'block'}>
		{keyedLine.tokens.length === 0
			? '\n'
			: keyedLine.tokens.map(({ token, key }) => (
					<TokenSpan key={key} token={token} />
				))}
	</span>
);

// Types
/** Props for the CodeBlock component: source code, its language, and an optional line-number toggle. */
type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
	code: string;
	language: BundledLanguage;
	showLineNumbers?: boolean;
};

/** Highlighted code: the themed token grid plus resolved foreground and background colors. */
export interface TokenizedCode {
	tokens: ThemedToken[][];
	fg: string;
	bg: string;
}

/** Context value exposing the raw source code to CodeBlock subcomponents. */
interface CodeBlockContextType {
	code: string;
}

// Context
const CodeBlockContext = createContext<CodeBlockContextType>({
	code: '',
});

// Highlighter cache (singleton per language)
const highlighterCache = new Map<
	string,
	Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>
>();

// Token cache
const tokensCache = new Map<string, TokenizedCode>();

// Subscribers for async token updates
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>();

/**
 * Build a cache key for highlighted tokens from the theme, language, and a code fingerprint.
 * @param code - Source code being highlighted
 * @param language - Shiki language id
 * @param theme - Shiki theme id
 * @returns A cache key that fingerprints the code without hashing all of it
 */
const getTokensCacheKey = (
	code: string,
	language: BundledLanguage,
	theme: BundledTheme,
) => {
	const start = code.slice(0, 100);
	const end = code.length > 100 ? code.slice(-100) : '';
	return `${theme}:${language}:${code.length}:${start}:${end}`;
};

/**
 * Get or lazily create the cached Shiki highlighter for a language.
 * @param language - Shiki language to load
 * @returns A promise resolving to the shared highlighter instance
 */
const getHighlighter = (
	language: BundledLanguage,
): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> => {
	const cached = highlighterCache.get(language);
	if (cached) {
		return cached;
	}

	const highlighterPromise = createHighlighter({
		langs: [language],
		themes: ['github-light', 'github-dark'],
	});

	highlighterCache.set(language, highlighterPromise);
	return highlighterPromise;
};

// Create raw tokens for immediate display while highlighting loads
/**
 * Build unstyled tokens so code renders immediately before Shiki finishes highlighting.
 * @param code - Source code to wrap as raw tokens
 * @returns Tokenized code with inherited colors and one token per line
 */
const createRawTokens = (code: string): TokenizedCode => ({
	bg: 'transparent',
	fg: 'inherit',
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

// Synchronous highlight with callback for async results
/**
 * Return cached highlighted tokens synchronously, otherwise kick off async Shiki highlighting and resolve via callback.
 * @param code - Source code to highlight
 * @param language - Shiki language id
 * @param theme - Shiki theme id
 * @param callback - Optional subscriber invoked once async highlighting resolves
 * @returns The cached tokens, or null while highlighting runs in the background
 */
export const highlightCode = (
	code: string,
	language: BundledLanguage,
	theme: BundledTheme,
	// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
	callback?: (result: TokenizedCode) => void,
): TokenizedCode | null => {
	const tokensCacheKey = getTokensCacheKey(code, language, theme);

	// Return cached result if available
	const cached = tokensCache.get(tokensCacheKey);
	if (cached) {
		return cached;
	}

	// Subscribe callback if provided
	if (callback) {
		if (!subscribers.has(tokensCacheKey)) {
			subscribers.set(tokensCacheKey, new Set());
		}
		subscribers.get(tokensCacheKey)?.add(callback);
	}

	// Start highlighting in background - fire-and-forget async pattern
	getHighlighter(language)
		// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
		.then(async (highlighter) => {
			const availableLangs = highlighter.getLoadedLanguages();
			const langToUse = availableLangs.includes(language) ? language : 'text';

			// Only github-* are preloaded; other picked themes load on demand.
			if (!highlighter.getLoadedThemes().includes(theme)) {
				await highlighter.loadTheme(theme);
			}

			// Feed the single picked theme to both slots so it wins in light and
			// dark app modes (the `--shiki-dark` swap becomes a no-op).
			const result = highlighter.codeToTokens(code, {
				lang: langToUse,
				themes: {
					dark: theme,
					light: theme,
				},
			});

			const tokenized: TokenizedCode = {
				bg: result.bg ?? 'transparent',
				fg: result.fg ?? 'inherit',
				tokens: result.tokens,
			};

			// Cache the result
			tokensCache.set(tokensCacheKey, tokenized);

			// Notify all subscribers
			const subs = subscribers.get(tokensCacheKey);
			if (subs) {
				for (const sub of subs) {
					sub(tokenized);
				}
				subscribers.delete(tokensCacheKey);
			}
		})
		// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
		.catch((error) => {
			console.error('Failed to highlight code:', error);
			subscribers.delete(tokensCacheKey);
		});

	return null;
};

/** Renders the highlighted token grid inside a styled pre/code block; memoized against its tokens and options. */
const CodeBlockBody = memo(
	({
		tokenized,
		showLineNumbers,
		className,
	}: {
		tokenized: TokenizedCode;
		showLineNumbers: boolean;
		className?: string;
	}) => {
		const preStyle = useMemo(
			() => ({
				backgroundColor: tokenized.bg,
				color: tokenized.fg,
			}),
			[tokenized.bg, tokenized.fg],
		);

		const keyedLines = useMemo(
			() => addKeysToTokens(tokenized.tokens),
			[tokenized.tokens],
		);

		return (
			<pre
				className={cn(
					'dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)] m-0 p-4 text-sm',
					className,
				)}
				style={preStyle}
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
						/>
					))}
				</code>
			</pre>
		);
	},
	(prevProps, nextProps) =>
		prevProps.tokenized === nextProps.tokenized &&
		prevProps.showLineNumbers === nextProps.showLineNumbers &&
		prevProps.className === nextProps.className,
);

CodeBlockBody.displayName = 'CodeBlockBody';

/** Highlights and renders code for a language, showing raw tokens immediately and swapping in Shiki output once it loads. */
export const CodeBlockContent = ({
	code,
	language,
	showLineNumbers = false,
}: {
	code: string;
	language: BundledLanguage;
	showLineNumbers?: boolean;
}) => {
	// Picked syntax theme (Settings → Appearance → Code theme).
	const codeTheme = useAtomValue(codeThemeAtom);

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
		<div className='relative overflow-auto'>
			<CodeBlockBody showLineNumbers={showLineNumbers} tokenized={tokenized} />
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
				/>
			</CodeBlockContainer>
		</CodeBlockContext.Provider>
	);
};
