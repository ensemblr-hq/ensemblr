import { useEffect, useMemo, useState } from 'react';
import type { BundledLanguage } from 'shiki';
import { highlightCode } from '@/renderer/lib/code/highlighter';
import { useResolvedCodeTheme } from '@/renderer/state/preferences';
import type { TokenizedCode } from '@/renderer/types/code';

/** Shared empty async-token map, so clearing one never allocates a new identity. */
const NO_ASYNC_TOKENS: ReadonlyMap<string, TokenizedCode> = new Map();

/**
 * Subscribes to Shiki highlighting for one code payload, following the theme
 * picked in Settings → Appearance → Code theme.
 *
 * Highlighting resolves from cache synchronously when the same code and theme
 * were shown before, and asynchronously otherwise — callers render the raw text
 * meanwhile, which swaps in colour with no reflow. Only the token colours are
 * the theme's to give: the surface under them belongs to the app's `code`
 * tokens, so a light theme never paints a light panel inside a dark window.
 * @param code - Source text to highlight
 * @param language - Shiki grammar to highlight it with
 * @returns The tokens, or null until highlighting resolves
 */
export function useHighlightedCode(
	code: string,
	language: BundledLanguage,
): TokenizedCode | null {
	const theme = useResolvedCodeTheme();
	const [asyncTokens, setAsyncTokens] = useState<TokenizedCode | null>(null);
	const [key, setKey] = useState({ code, language, theme });

	// Drop the previous payload's tokens during render, so stale syntax colours
	// never paint against different text — or against a different theme — for a
	// frame after the input changes.
	if (key.code !== code || key.language !== language || key.theme !== theme) {
		setKey({ code, language, theme });
		setAsyncTokens(null);
	}

	const syncTokens = useMemo(
		() => highlightCode(code, language, theme),
		[code, language, theme],
	);

	useEffect(() => {
		let cancelled = false;
		// highlightCode fires the callback only for a fresh async highlight; on a
		// warm cache it returns synchronously and never calls back. Capture that
		// return so the tokens are never dropped.
		const immediate = highlightCode(code, language, theme, (result) => {
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
	}, [code, language, theme]);

	return syncTokens ?? asyncTokens;
}

/**
 * Subscribes to Shiki highlighting for each hunk of a patch independently,
 * following the theme picked in Settings → Appearance → Code theme.
 *
 * Hunks cannot be joined and highlighted as one source: a patch omits the
 * unchanged lines between them, so a construct like an unterminated block
 * comment would bleed its state into every later hunk.
 *
 * Cache hits are derived during render; only the tokens that arrive later live
 * in state, keyed by their own source text so a hunk can never be handed the
 * colours of the text that previously sat at its index.
 * @param sources - One source string per hunk, in document order
 * @param language - Shiki grammar to highlight them with
 * @returns One token set per hunk, each null until it resolves
 */
export function useHighlightedHunks(
	sources: readonly string[],
	language: BundledLanguage,
): readonly (TokenizedCode | null)[] {
	const theme = useResolvedCodeTheme();
	const [asyncTokens, setAsyncTokens] =
		useState<ReadonlyMap<string, TokenizedCode>>(NO_ASYNC_TOKENS);
	const [key, setKey] = useState({ language, theme });

	// Async tokens are keyed by source text alone, so a grammar or theme switch
	// has to clear them during render or the old theme's colours would survive it.
	if (key.language !== language || key.theme !== theme) {
		setKey({ language, theme });
		setAsyncTokens(NO_ASYNC_TOKENS);
	}

	const syncTokens = useMemo(
		() => sources.map((source) => highlightCode(source, language, theme)),
		[sources, language, theme],
	);

	useEffect(() => {
		let cancelled = false;
		const remember = (source: string, result: TokenizedCode) => {
			if (!cancelled) {
				setAsyncTokens((previous) => new Map(previous).set(source, result));
			}
		};
		for (const source of sources) {
			// highlightCode calls back only for a fresh run; a hunk whose tokens
			// landed between this render and this effect comes back synchronously
			// instead, and dropping that return would leave it uncoloured.
			const immediate = highlightCode(source, language, theme, (result) =>
				remember(source, result),
			);
			if (immediate) {
				remember(source, immediate);
			}
		}
		return () => {
			cancelled = true;
		};
	}, [sources, language, theme]);

	return useMemo(
		() =>
			sources.map(
				(source, index) => syncTokens[index] ?? asyncTokens.get(source) ?? null,
			),
		[sources, syncTokens, asyncTokens],
	);
}
