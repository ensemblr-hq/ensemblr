// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { TokenizedCode } from '../../src/renderer/types/code';

const cache = vi.hoisted(() => new Map<string, TokenizedCode>());
const waiting = vi.hoisted(
	() => new Map<string, (result: TokenizedCode) => void>(),
);
const requested = vi.hoisted(() => [] as string[]);

vi.mock('../../src/renderer/lib/code/highlighter', () => ({
	highlightCode: (
		code: string,
		_language: string,
		_theme: string,
		callback?: (result: TokenizedCode) => void,
	) => {
		const hit = cache.get(code);
		if (hit) {
			return hit;
		}
		if (callback) {
			requested.push(code);
			waiting.set(code, callback);
		}
		return null;
	},
}));

import { useHighlightedHunks } from '../../src/renderer/hooks/code-surface/use-highlighted-code';

function tokensFor(code: string): TokenizedCode {
	return {
		tokens: [[{ color: '#ffffff', content: code, fontStyle: 0, offset: 0 }]],
	};
}

function resolveHunk(code: string) {
	const callback = waiting.get(code);
	waiting.delete(code);
	act(() => callback?.(tokensFor(code)));
}

function renderHunks(sources: readonly string[]) {
	return renderHook(
		({ hunks }: { hunks: readonly string[] }) =>
			useHighlightedHunks(hunks, 'typescript'),
		{ initialProps: { hunks: sources } },
	);
}

beforeEach(() => {
	cache.clear();
	waiting.clear();
	requested.length = 0;
});

describe('per-hunk diff highlighting', () => {
	test('highlights every hunk on its own so grammar state cannot bleed across gaps', () => {
		const { result } = renderHunks(['const a = 1;', 'const b = 2;']);

		expect(requested).toEqual(['const a = 1;', 'const b = 2;']);
		expect(result.current).toEqual([null, null]);
	});

	test('colours only the hunk whose tokens arrived', () => {
		const { result } = renderHunks(['const a = 1;', 'const b = 2;']);

		resolveHunk('const b = 2;');

		expect(result.current).toEqual([null, tokensFor('const b = 2;')]);
	});

	test('keeps resolved tokens with their source when hunks change position', () => {
		const { rerender, result } = renderHunks(['const a = 1;', 'const b = 2;']);
		resolveHunk('const b = 2;');

		rerender({ hunks: ['const b = 2;', 'const a = 1;'] });

		expect(result.current).toEqual([tokensFor('const b = 2;'), null]);
	});

	test('derives a warm cache hit without waiting for an async round trip', () => {
		cache.set('const a = 1;', tokensFor('const a = 1;'));

		const { result } = renderHunks(['const a = 1;', 'const b = 2;']);

		expect(requested).toEqual(['const b = 2;']);
		expect(result.current).toEqual([tokensFor('const a = 1;'), null]);
	});
});
