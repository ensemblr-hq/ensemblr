import { describe, expect, test } from 'vitest';

import {
	readCachedPiModels,
	writeCachedPiModels,
} from '../../src/renderer/api/ensemble/pi-models-cache';
import type { ListPiModelsResult } from '../../src/shared/ipc/contracts/pi-session';

const KEY = 'ensemble_pref_pi_models_snapshot';

/** Minimal Map-backed Storage for deterministic, DOM-free tests. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
	const map = new Map(Object.entries(initial));
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k) => map.get(k) ?? null,
		key: (i) => [...map.keys()][i] ?? null,
		removeItem: (k) => {
			map.delete(k);
		},
		setItem: (k, v) => {
			map.set(k, v);
		},
	} satisfies Storage;
}

const CATALOG: ListPiModelsResult = {
	defaultModelId: 'anthropic/sonnet',
	defaultThinkingLevel: 'medium',
	models: [
		{
			displayName: 'Sonnet',
			id: 'anthropic/sonnet',
			provider: 'anthropic',
			thinkingLevels: ['off', 'medium', 'high'],
		},
	],
};

const EMPTY: ListPiModelsResult = {
	defaultModelId: null,
	defaultThinkingLevel: null,
	models: [],
};

describe('pi-models-cache', () => {
	test('round-trips a non-empty catalog', () => {
		const store = fakeStorage();
		writeCachedPiModels(CATALOG, store);
		expect(readCachedPiModels(store)).toEqual(CATALOG);
	});

	test('reads undefined from an empty store', () => {
		expect(readCachedPiModels(fakeStorage())).toBeUndefined();
	});

	test('writing an empty result preserves the prior cached catalog', () => {
		const store = fakeStorage();
		writeCachedPiModels(CATALOG, store);
		writeCachedPiModels(EMPTY, store);
		expect(readCachedPiModels(store)).toEqual(CATALOG);
	});

	test('returns undefined for corrupt JSON', () => {
		const store = fakeStorage({ [KEY]: '{not json' });
		expect(readCachedPiModels(store)).toBeUndefined();
	});

	test('returns undefined for a valid-JSON but wrong-shape entry', () => {
		const store = fakeStorage({ [KEY]: JSON.stringify({ models: 'nope' }) });
		expect(readCachedPiModels(store)).toBeUndefined();
	});

	test('returns undefined when the stored catalog is empty', () => {
		const store = fakeStorage({ [KEY]: JSON.stringify(EMPTY) });
		expect(readCachedPiModels(store)).toBeUndefined();
	});
});
