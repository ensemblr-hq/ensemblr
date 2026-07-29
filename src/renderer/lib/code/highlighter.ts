import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki';
import { createHighlighter } from 'shiki';

import type { TokenizedCode } from '@/renderer/types/code';

/**
 * How many tokenized sources stay cached. A renderer window lives for days, so
 * an unbounded cache would retain every snippet ever scrolled past; 200 entries
 * cover the scrollback a conversation revisits while keeping the ceiling fixed.
 */
const MAX_CACHED_SOURCES = 200;

/** Offset basis of the 32-bit FNV-1a hash. */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** Prime multiplier of the 32-bit FNV-1a hash. */
const FNV_PRIME = 0x01000193;

/** A cached tokenization together with the exact source that produced it. */
interface CachedTokens {
	code: string;
	tokens: TokenizedCode;
}

/** A tokenization already running, with the source it covers and everyone awaiting it. */
interface PendingHighlight {
	code: string;
	subscribers: Set<(result: TokenizedCode) => void>;
}

const highlighterCache = new Map<
	string,
	Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>
>();

const tokensCache = new Map<string, CachedTokens>();

const pendingHighlights = new Map<string, PendingHighlight>();

/**
 * Hash a whole string with 32-bit FNV-1a so any character change moves the key.
 * Non-cryptographic on purpose: synchronous WebCrypto is unavailable in the
 * renderer, and a digest would cost more than the tokenization it guards.
 * @param value - String to hash
 * @returns The hash rendered in base 36
 */
const hashString = (value: string): string => {
	let hash = FNV_OFFSET_BASIS;
	for (let index = 0; index < value.length; index += 1) {
		// oxlint-disable-next-line eslint(no-bitwise)
		hash = Math.imul(hash ^ value.charCodeAt(index), FNV_PRIME);
	}
	// oxlint-disable-next-line eslint(no-bitwise)
	return (hash >>> 0).toString(36);
};

/**
 * Build the tokens cache key for one source under one language and theme.
 * @param code - Source code being highlighted
 * @param language - Shiki language id
 * @param theme - Shiki theme id
 * @returns A cache key derived from every character of the code
 */
const getTokensCacheKey = (
	code: string,
	language: BundledLanguage,
	theme: BundledTheme,
): string => `${theme}:${language}:${code.length}:${hashString(code)}`;

/**
 * Read cached tokens and mark the entry most recently used, rejecting an entry
 * whose stored source differs so a hash collision can never paint one snippet's
 * text with another snippet's tokens.
 * @param cacheKey - Key the tokens would be filed under
 * @param code - Source the caller wants tokens for
 * @returns The cached tokens, or null on a miss
 */
const readTokensCache = (
	cacheKey: string,
	code: string,
): TokenizedCode | null => {
	const entry = tokensCache.get(cacheKey);
	if (!entry || entry.code !== code) {
		return null;
	}
	tokensCache.delete(cacheKey);
	tokensCache.set(cacheKey, entry);
	return entry.tokens;
};

/**
 * Cache one tokenization, evicting least recently used entries once the cache is full.
 * @param cacheKey - Key to file the tokens under
 * @param code - Source that produced the tokens
 * @param tokens - The tokenized result
 */
const writeTokensCache = (
	cacheKey: string,
	code: string,
	tokens: TokenizedCode,
): void => {
	tokensCache.delete(cacheKey);
	tokensCache.set(cacheKey, { code, tokens });
	while (tokensCache.size > MAX_CACHED_SOURCES) {
		const oldestKey = tokensCache.keys().next().value;
		if (oldestKey === undefined) {
			break;
		}
		tokensCache.delete(oldestKey);
	}
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
	// A rejected promise stays rejected, so evict it and let the next call retry;
	// the rejection is reported by whoever awaits the promise returned here.
	// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
	highlighterPromise.catch(() => {
		if (highlighterCache.get(language) === highlighterPromise) {
			highlighterCache.delete(language);
		}
	});
	return highlighterPromise;
};

/**
 * Tokenize one source with Shiki, loading the picked theme on demand.
 * @param code - Source code to tokenize
 * @param language - Shiki language id
 * @param theme - Shiki theme id
 * @returns The themed token grid for the source
 */
const tokenizeWithShiki = async (
	code: string,
	language: BundledLanguage,
	theme: BundledTheme,
): Promise<TokenizedCode> => {
	const highlighter = await getHighlighter(language);
	const availableLangs = highlighter.getLoadedLanguages();
	const langToUse = availableLangs.includes(language) ? language : 'text';

	// Only github-* are preloaded; other picked themes load on demand.
	if (!highlighter.getLoadedThemes().includes(theme)) {
		await highlighter.loadTheme(theme);
	}

	// Feed the single resolved theme to both slots so it wins in light and dark
	// app modes (the `--shiki-dark` swap becomes a no-op).
	const result = highlighter.codeToTokens(code, {
		lang: langToUse,
		themes: {
			dark: theme,
			light: theme,
		},
	});

	return { tokens: result.tokens };
};

/**
 * Forget an in-flight record once its run settles, leaving a newer record in place.
 * @param cacheKey - Key the record was filed under
 * @param record - The record whose run just settled
 */
const releasePending = (cacheKey: string, record: PendingHighlight): void => {
	if (pendingHighlights.get(cacheKey) === record) {
		pendingHighlights.delete(cacheKey);
	}
};

/**
 * Run one tokenization and hand the result to every caller that joined this run.
 * @param cacheKey - Key the result is cached under
 * @param record - In-flight record owning the source and its subscribers
 * @param language - Shiki language id
 * @param theme - Shiki theme id
 */
const startHighlight = (
	cacheKey: string,
	record: PendingHighlight,
	language: BundledLanguage,
	theme: BundledTheme,
): void => {
	tokenizeWithShiki(record.code, language, theme)
		// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
		.then((tokenized) => {
			writeTokensCache(cacheKey, record.code, tokenized);
			releasePending(cacheKey, record);
			for (const notify of record.subscribers) {
				notify(tokenized);
			}
		})
		// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
		.catch((error) => {
			console.error('Failed to highlight code:', error);
			releasePending(cacheKey, record);
		});
};

/**
 * Look up highlighted tokens for one source and, when a callback is supplied,
 * start the Shiki work that will produce them.
 *
 * Without a callback this is a pure cache read, so a render can probe for tokens
 * without ever scheduling work — the effect that passes a callback is what starts
 * it. Callers waiting on the same source share a single tokenization.
 * @param code - Source code to highlight
 * @param language - Shiki language id
 * @param theme - Shiki theme id
 * @param callback - Subscriber invoked once async highlighting resolves; supplying it also opts this call into starting the work
 * @returns The cached tokens, or null while they are unavailable
 */
export const highlightCode = (
	code: string,
	language: BundledLanguage,
	theme: BundledTheme,
	// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
	callback?: (result: TokenizedCode) => void,
): TokenizedCode | null => {
	const cacheKey = getTokensCacheKey(code, language, theme);

	const cached = readTokensCache(cacheKey, code);
	if (cached) {
		return cached;
	}

	if (!callback) {
		return null;
	}

	const pending = pendingHighlights.get(cacheKey);
	if (pending?.code === code) {
		pending.subscribers.add(callback);
		return null;
	}

	const record: PendingHighlight = { code, subscribers: new Set([callback]) };
	pendingHighlights.set(cacheKey, record);
	startHighlight(cacheKey, record, language, theme);

	return null;
};
