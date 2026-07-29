import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { TokenizedCode } from '../../src/renderer/types/code';

const createHighlighter = vi.hoisted(() => vi.fn());
const codeToTokens = vi.hoisted(() => vi.fn());
const loadTheme = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('shiki', () => ({ createHighlighter }));

const LANGUAGE = 'typescript';
const THEME = 'github-dark';
const CACHE_CAP = 200;

// Same length, same first and last 100 characters, different middles — the
// fingerprint the cache key used to be built from cannot tell these apart.
const SHARED_HEAD = 'a'.repeat(100);
const SHARED_TAIL = 'z'.repeat(100);
const FIRST = `${SHARED_HEAD}${'b'.repeat(116)}${SHARED_TAIL}`;
const SECOND = `${SHARED_HEAD}${'c'.repeat(116)}${SHARED_TAIL}`;

type Highlighter = typeof import('../../src/renderer/lib/code/highlighter');

async function freshModule(): Promise<Highlighter> {
	vi.resetModules();
	return await import('../../src/renderer/lib/code/highlighter');
}

function tokensFor(code: string): TokenizedCode {
	return {
		tokens: [[{ color: '#ffffff', content: code, fontStyle: 0, offset: 0 }]],
	};
}

function highlight(module: Highlighter, code: string): Promise<TokenizedCode> {
	return new Promise((resolve) => {
		const immediate = module.highlightCode(code, LANGUAGE, THEME, resolve);
		if (immediate) {
			resolve(immediate);
		}
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	createHighlighter.mockImplementation(async () => ({
		codeToTokens,
		getLoadedLanguages: () => [LANGUAGE],
		getLoadedThemes: () => [THEME],
		loadTheme,
	}));
	codeToTokens.mockImplementation((code: string) => tokensFor(code));
});

describe('shared code highlighter cache', () => {
	test('keys two sources apart when they differ only in the middle', async () => {
		const module = await freshModule();

		expect(await highlight(module, FIRST)).toEqual(tokensFor(FIRST));
		expect(module.highlightCode(SECOND, LANGUAGE, THEME)).toBeNull();
		expect(await highlight(module, SECOND)).toEqual(tokensFor(SECOND));
		expect(module.highlightCode(FIRST, LANGUAGE, THEME)).toEqual(
			tokensFor(FIRST),
		);
	});

	test('shares one tokenization between callers waiting on the same source', async () => {
		const module = await freshModule();

		const results = await Promise.all([
			highlight(module, 'const x = 1;'),
			highlight(module, 'const x = 1;'),
			highlight(module, 'const x = 1;'),
		]);

		expect(results).toEqual([
			tokensFor('const x = 1;'),
			tokensFor('const x = 1;'),
			tokensFor('const x = 1;'),
		]);
		expect(codeToTokens).toHaveBeenCalledTimes(1);
	});

	test('starts no work for a callback-less lookup', async () => {
		const module = await freshModule();

		expect(module.highlightCode('const y = 2;', LANGUAGE, THEME)).toBeNull();
		await Promise.resolve();

		expect(createHighlighter).not.toHaveBeenCalled();
	});

	test('retries the highlighter after a failed load instead of caching the rejection', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		createHighlighter.mockRejectedValueOnce(new Error('wasm unavailable'));
		const module = await freshModule();

		module.highlightCode('const z = 3;', LANGUAGE, THEME, () => {});
		await vi.waitFor(() => expect(errors).toHaveBeenCalled());

		expect(await highlight(module, 'const z = 3;')).toEqual(
			tokensFor('const z = 3;'),
		);
		expect(createHighlighter).toHaveBeenCalledTimes(2);
		errors.mockRestore();
	});

	test('evicts the least recently used source once the cache is full', async () => {
		const module = await freshModule();
		const oldest = 'source 0';

		for (let index = 0; index <= CACHE_CAP; index += 1) {
			await highlight(module, `source ${index}`);
		}

		expect(module.highlightCode(oldest, LANGUAGE, THEME)).toBeNull();
		expect(
			module.highlightCode(`source ${CACHE_CAP}`, LANGUAGE, THEME),
		).toEqual(tokensFor(`source ${CACHE_CAP}`));
	});
});
