import { useAtomValue } from 'jotai';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
	type HunkData,
	markEdits,
	markWord,
	pickRanges,
	tokenize,
} from 'react-diff-view';
import type { BundledLanguage, BundledTheme, ThemedToken } from 'shiki';

import {
	highlightCode,
	type TokenizedCode,
} from '@/renderer/components/code-block';
import { codeThemeAtom } from '@/renderer/state/preferences';
import { reconstructSideSources } from './parse';

// Shiki font-style bitflags: 1=italic, 2=bold, 4=underline.
const ITALIC_BIT = 1;
const BOLD_BIT = 2;
const UNDERLINE_BIT = 4;

/** A syntax-color range for react-diff-view's `pickRanges`, keyed by line + column. */
interface SyntaxRange {
	color?: string;
	fontStyle?: number;
	length: number;
	lineNumber: number;
	start: number;
	type: 'syntax';
}

/**
 * Resolve a Shiki token's color and font-style bitflags from its dual-theme
 * `htmlStyle` (what the shared highlighter emits) before falling back to the
 * single-theme `color`/`fontStyle` fields. The highlighter feeds one picked
 * theme into both theme slots, so Shiki writes the color into `htmlStyle.color`
 * and leaves the top-level `color` undefined; reading only `token.color` left
 * every diff token colorless.
 * @param token - One Shiki themed token
 * @returns The token's resolved color and font-style bitflags
 */
function resolveTokenStyle(token: ThemedToken): {
	color?: string;
	fontStyle: number;
} {
	const htmlStyle =
		typeof token.htmlStyle === 'object' ? token.htmlStyle : undefined;
	const color = htmlStyle?.color ?? token.color;
	if (typeof token.fontStyle === 'number' && token.fontStyle > 0) {
		return { color, fontStyle: token.fontStyle };
	}
	if (!htmlStyle) {
		return { color, fontStyle: 0 };
	}
	// oxlint-disable-next-line eslint(no-bitwise)
	const italic = htmlStyle['font-style'] === 'italic' ? ITALIC_BIT : 0;
	const bold =
		htmlStyle['font-weight'] === 'bold' || htmlStyle['font-weight'] === '700'
			? BOLD_BIT
			: 0;
	const underline =
		htmlStyle['text-decoration'] === 'underline' ? UNDERLINE_BIT : 0;
	// oxlint-disable-next-line eslint(no-bitwise)
	return { color, fontStyle: italic | bold | underline };
}

/**
 * Convert Shiki's per-line themed tokens into `pickRanges` syntax ranges. Line
 * numbers are 1-based file line numbers and column offsets are character
 * indexes, both matching react-diff-view's line-indexed token trees.
 * @param tokenized - Shiki output for one side's reconstructed source
 * @returns Syntax ranges to wrap each colored token
 */
function toSyntaxRanges(tokenized: TokenizedCode): SyntaxRange[] {
	const ranges: SyntaxRange[] = [];
	tokenized.tokens.forEach((line, lineIndex) => {
		let start = 0;
		for (const token of line) {
			const length = token.content.length;
			if (length > 0 && token.content.trim().length > 0) {
				const { color, fontStyle } = resolveTokenStyle(token);
				ranges.push({
					color,
					fontStyle,
					length,
					lineNumber: lineIndex + 1,
					start,
					type: 'syntax',
				});
			}
			start += length;
		}
	});
	return ranges;
}

/**
 * Highlight a source text with the shared Shiki highlighter, returning cached
 * tokens synchronously and swapping in async results once highlighting resolves.
 * @param text - Source text to highlight
 * @param language - Shiki language id
 * @param theme - Shiki theme id
 * @returns The tokenized code, or null until highlighting is available
 */
function useSideTokens(
	text: string,
	language: BundledLanguage,
	theme: BundledTheme,
): TokenizedCode | null {
	const [asyncTokens, setAsyncTokens] = useState<TokenizedCode | null>(null);
	const [key, setKey] = useState({ language, text, theme });

	// Drop the previous side's async tokens synchronously when the input changes,
	// so stale syntax colors never render against different text for a frame.
	if (key.text !== text || key.language !== language || key.theme !== theme) {
		setKey({ language, text, theme });
		setAsyncTokens(null);
	}

	const syncTokens = useMemo(
		() => highlightCode(text, language, theme),
		[text, language, theme],
	);

	useEffect(() => {
		let cancelled = false;
		// highlightCode fires the callback only for a fresh async highlight; on a
		// warm-highlighter cache hit it returns the tokens synchronously and never
		// calls back. Capture that return so the tokens are never dropped — without
		// it the diff stays un-highlighted whenever the language is already loaded.
		const immediate = highlightCode(text, language, theme, (result) => {
			if (!cancelled) {
				setAsyncTokens(result);
			}
		});
		if (immediate) {
			setAsyncTokens(immediate);
		}
		return () => {
			cancelled = true;
		};
	}, [text, language, theme]);

	return syncTokens ?? asyncTokens;
}

/**
 * Build react-diff-view token trees for a diff, bridging the app's Shiki
 * highlighter into react-diff-view via `pickRanges`, with optional whitespace
 * markers and word-level edit marks. Returns null until both sides finish
 * highlighting so the caller can render un-tokenized text first.
 * @param hunks - The file's parsed hunks
 * @param language - Shiki language id for the file
 * @param showWhitespace - Whether to reveal tabs and carriage returns as glyphs
 * @returns The token trees for react-diff-view, or null while highlighting loads
 */
export function useDiffTokens(
	hunks: readonly HunkData[],
	language: BundledLanguage,
	showWhitespace: boolean,
): ReturnType<typeof tokenize> | null {
	const theme = useAtomValue(codeThemeAtom);
	const { oldText, newText } = useMemo(
		() => reconstructSideSources(hunks),
		[hunks],
	);
	const oldTokens = useSideTokens(oldText, language, theme);
	const newTokens = useSideTokens(newText, language, theme);

	return useMemo(() => {
		if (!oldTokens || !newTokens) {
			return null;
		}
		const enhancers = [
			pickRanges(
				toSyntaxRanges(oldTokens) as never,
				toSyntaxRanges(newTokens) as never,
			),
			markEdits(hunks as HunkData[], { type: 'block' }),
			...(showWhitespace
				? [markWord('\t', 'tab', '→'), markWord('\r', 'carriage-return', '␍')]
				: []),
		];
		try {
			return tokenize(hunks as HunkData[], { enhancers, highlight: false });
		} catch {
			return null;
		}
	}, [hunks, oldTokens, newTokens, showWhitespace]);
}

/** Open token-node shape react-diff-view passes to a custom `renderToken`. */
interface DiffTokenNode {
	children?: DiffTokenNode[];
	color?: string;
	fontStyle?: number;
	markType?: string;
	type: string;
	value?: string;
}

/** The default token renderer react-diff-view hands to a custom `renderToken`. */
type DefaultTokenRender = (token: DiffTokenNode, index: number) => ReactNode;

/**
 * Resolve the inline CSS style for a Shiki syntax token node.
 * @param token - The syntax token node carrying color and font-style bits
 * @returns The inline style properties for the token span
 */
function syntaxStyle(token: DiffTokenNode): CSSProperties {
	const fontStyle = token.fontStyle ?? 0;
	return {
		color: token.color,
		// oxlint-disable-next-line eslint(no-bitwise)
		...(fontStyle & ITALIC_BIT ? { fontStyle: 'italic' as const } : {}),
		// oxlint-disable-next-line eslint(no-bitwise)
		...(fontStyle & BOLD_BIT ? { fontWeight: 'bold' as const } : {}),
		// oxlint-disable-next-line eslint(no-bitwise)
		...(fontStyle & UNDERLINE_BIT
			? { textDecoration: 'underline' as const }
			: {}),
	};
}

/**
 * Render one react-diff-view token, applying Shiki colors to `syntax` nodes and
 * class names to edit/mark nodes, recursing through children so nesting order
 * never drops a color.
 * @param token - The token node to render
 * @param renderDefault - The library's default token renderer
 * @param index - The token's index within its parent for the React key
 * @returns The rendered token
 */
export function renderDiffToken(
	token: DiffTokenNode,
	renderDefault: DefaultTokenRender,
	index: number,
): ReactNode {
	const renderChildren = (): ReactNode =>
		Array.isArray(token.children)
			? token.children.map((child, childIndex) =>
					renderDiffToken(child, renderDefault, childIndex),
				)
			: token.value;

	switch (token.type) {
		case 'syntax':
			return (
				<span key={index} style={syntaxStyle(token)}>
					{renderChildren()}
				</span>
			);
		case 'edit':
			return (
				<span className='diff-code-edit' key={index}>
					{renderChildren()}
				</span>
			);
		case 'mark':
			return (
				<span
					className={`diff-code-mark diff-code-mark-${token.markType}`}
					key={index}
				>
					{token.value}
				</span>
			);
		case 'text':
			return token.value;
		default:
			return renderDefault(token, index);
	}
}
