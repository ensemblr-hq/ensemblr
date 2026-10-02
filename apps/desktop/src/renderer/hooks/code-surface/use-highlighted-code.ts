import { useEffect, useMemo, useRef, useState } from 'react';
import type { BundledLanguage, BundledTheme } from 'shiki';
import { highlightCode } from '@/renderer/lib/code';
import { useResolvedCodeTheme } from '@/renderer/state/preferences';
import type { TokenizedCode } from '@/renderer/types/code';
import { isWithinHighlightBudget } from './highlight-budget.ts';

/** Shared empty async-token map, so clearing one never allocates a new identity. */
const NO_ASYNC_TOKENS: ReadonlyMap<string, TokenizedCode> = new Map();

/**
 * Reads tokens for a source, refusing outright anything over the highlight
 * budget so an oversized payload never reaches Shiki's synchronous pass.
 *
 * The refusal has to sit in front of every call rather than inside the
 * highlighter, because the cache read and the work that fills it share one
 * entry point: an over-budget source that slipped through once would be
 * answered from cache forever after, and the freeze happens on that first pass.
 * @param code - Source text to highlight
 * @param language - Shiki grammar to highlight it with
 * @param theme - Shiki theme id
 * @param callback - Subscriber invoked once async highlighting resolves; supplying it also opts this call into starting the work
 * @returns The cached tokens, or null when unavailable or over budget
 */
function highlightWithinBudget(
	code: string,
	language: BundledLanguage,
	theme: BundledTheme,
	// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
	callback?: (result: TokenizedCode) => void,
): TokenizedCode | null {
	if (!isWithinHighlightBudget(code)) {
		return null;
	}
	return highlightCode(code, language, theme, callback);
}

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
		() => highlightWithinBudget(code, language, theme),
		[code, language, theme],
	);

	useEffect(() => {
		if (syncTokens) {
			return;
		}
		let cancelled = false;
		// highlightCode fires the callback only for a fresh async highlight; on a
		// cache warmed between this render and this effect it returns synchronously
		// and never calls back. Capture that return so the tokens are never dropped.
		const immediate = highlightWithinBudget(code, language, theme, (result) => {
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
	}, [code, language, theme, syncTokens]);

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
		() =>
			sources.map((source) => highlightWithinBudget(source, language, theme)),
		[sources, language, theme],
	);

	const pendingTokens = useRef(new Map<string, TokenizedCode>());
	const flushQueued = useRef(false);

	useEffect(() => {
		let cancelled = false;
		pendingTokens.current.clear();
		const flush = () => {
			flushQueued.current = false;
			if (cancelled || pendingTokens.current.size === 0) {
				return;
			}
			const arrived = pendingTokens.current;
			pendingTokens.current = new Map();
			setAsyncTokens((previous) => new Map([...previous, ...arrived]));
		};
		// One commit per burst, not per hunk: committing each on its own copied a
		// map that grew with every commit, so an n-hunk patch cost n renders and
		// O(n²) allocation.
		const remember = (source: string, result: TokenizedCode) => {
			if (cancelled) {
				return;
			}
			pendingTokens.current.set(source, result);
			if (!flushQueued.current) {
				flushQueued.current = true;
				queueMicrotask(flush);
			}
		};
		for (const [index, source] of sources.entries()) {
			if (syncTokens[index]) {
				continue;
			}
			// highlightCode calls back only for a fresh run; a hunk whose tokens
			// landed between this render and this effect comes back synchronously
			// instead, and dropping that return would leave it uncoloured.
			const immediate = highlightWithinBudget(
				source,
				language,
				theme,
				(result) => remember(source, result),
			);
			if (immediate) {
				remember(source, immediate);
			}
		}
		return () => {
			cancelled = true;
		};
	}, [sources, language, theme, syncTokens]);

	return useMemo(
		() =>
			sources.map(
				(source, index) => syncTokens[index] ?? asyncTokens.get(source) ?? null,
			),
		[sources, syncTokens, asyncTokens],
	);
}
