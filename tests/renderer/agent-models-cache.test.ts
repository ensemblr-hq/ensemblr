import { describe, expect, test } from 'vitest';

import {
	readCachedAgentModels,
	writeCachedAgentModels,
} from '../../src/renderer/api/ensemblr/agent-models-cache';
import type { AgentModelCatalog } from '../../src/shared/ipc/contracts/agent-models';
import { asModelVendorId } from '../../src/shared/ipc/contracts/agent-models';

const KEY = 'ensemblr_pref_pi_models_snapshot';

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

const CATALOG: AgentModelCatalog = {
	defaultModelId: 'anthropic/sonnet',
	defaultThinkingLevel: 'medium',
	models: [
		{
			agentProvider: 'pi' as const,
			contextWindow: 200_000,
			displayName: 'Sonnet',
			id: 'anthropic/sonnet',
			vendor: asModelVendorId('anthropic'),
			thinkingLevels: ['off', 'medium', 'high'],
		},
	],
};

const EMPTY: AgentModelCatalog = {
	defaultModelId: null,
	defaultThinkingLevel: null,
	models: [],
};

/** Two providers: the last-known-good catalog a cold start should preserve. */
const TWO_PROVIDERS: AgentModelCatalog = {
	defaultModelId: 'anthropic/sonnet',
	defaultThinkingLevel: 'medium',
	models: [
		{
			agentProvider: 'pi' as const,
			contextWindow: 200_000,
			displayName: 'Sonnet',
			id: 'anthropic/sonnet',
			vendor: asModelVendorId('anthropic'),
			thinkingLevels: ['off', 'medium', 'high'],
		},
		{
			agentProvider: 'pi' as const,
			contextWindow: 200_000,
			displayName: 'GPT',
			id: 'openai-codex/gpt-5.6-sol',
			vendor: asModelVendorId('openai-codex'),
			thinkingLevels: ['off', 'medium', 'high'],
		},
	],
};

/** A cold-start partial: the `openai-codex` provider has not resolved yet. */
const PARTIAL: AgentModelCatalog = {
	defaultModelId: 'anthropic/sonnet',
	defaultThinkingLevel: 'medium',
	models: [
		{
			agentProvider: 'pi' as const,
			contextWindow: 200_000,
			displayName: 'Sonnet',
			id: 'anthropic/sonnet',
			vendor: asModelVendorId('anthropic'),
			thinkingLevels: ['off', 'medium', 'high'],
		},
	],
};

describe('agent-models-cache', () => {
	test('round-trips a non-empty catalog', () => {
		const store = fakeStorage();
		writeCachedAgentModels(CATALOG, store);
		expect(readCachedAgentModels(store)).toEqual(CATALOG);
	});

	test('reads undefined from an empty store', () => {
		expect(readCachedAgentModels(fakeStorage())).toBeUndefined();
	});

	test('writing an empty result preserves the prior cached catalog', () => {
		const store = fakeStorage();
		writeCachedAgentModels(CATALOG, store);
		writeCachedAgentModels(EMPTY, store);
		expect(readCachedAgentModels(store)).toEqual(CATALOG);
	});

	test('returns undefined for corrupt JSON', () => {
		const store = fakeStorage({ [KEY]: '{not json' });
		expect(readCachedAgentModels(store)).toBeUndefined();
	});

	test('returns undefined for a valid-JSON but wrong-shape entry', () => {
		const store = fakeStorage({ [KEY]: JSON.stringify({ models: 'nope' }) });
		expect(readCachedAgentModels(store)).toBeUndefined();
	});

	test('returns undefined when the stored catalog is empty', () => {
		const store = fakeStorage({ [KEY]: JSON.stringify(EMPTY) });
		expect(readCachedAgentModels(store)).toBeUndefined();
	});

	test('a partial listing that drops a provider does not poison the cache', () => {
		const store = fakeStorage();
		writeCachedAgentModels(TWO_PROVIDERS, store);
		writeCachedAgentModels(PARTIAL, store);
		expect(readCachedAgentModels(store)).toEqual(TWO_PROVIDERS);
	});

	test('a listing that adds a provider overwrites the cache', () => {
		const store = fakeStorage();
		writeCachedAgentModels(PARTIAL, store);
		writeCachedAgentModels(TWO_PROVIDERS, store);
		expect(readCachedAgentModels(store)).toEqual(TWO_PROVIDERS);
	});
});
