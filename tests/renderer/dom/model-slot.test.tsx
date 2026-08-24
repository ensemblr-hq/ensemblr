// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { atom, createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useModelSlot } from '@/renderer/hooks/preferences/use-model-slot';
import type { AgentModelOption } from '@/shared/ipc/contracts/agent-models';

const OPUS = {
	agentProvider: 'claude',
	contextWindow: 200_000,
	displayName: 'Opus',
	id: 'opus',
	thinkingLevels: ['low', 'high'],
	vendor: 'anthropic',
} as unknown as AgentModelOption;

const PI_ONE = {
	agentProvider: 'pi',
	contextWindow: 100_000,
	displayName: 'Pi One',
	id: 'pi-one',
	thinkingLevels: ['medium'],
	vendor: 'earendil',
} as unknown as AgentModelOption;

const MODELS: readonly AgentModelOption[] = [OPUS, PI_ONE];

const renderSlot = (
	catalogue: Parameters<typeof useModelSlot>[0],
	onChoose?: Parameters<typeof useModelSlot>[3],
) => {
	const store = createStore();
	const modelAtom = atom<string | null>(null);
	const thinkingAtom = atom<string | null>(null);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	const view = renderHook(
		() => useModelSlot(catalogue, modelAtom, thinkingAtom, onChoose),
		{ wrapper },
	);
	return { ...view, modelAtom, store };
};

const catalogueOf = (hidden: string[] = [], list = MODELS) => ({
	agentDefaultModelId: 'opus',
	hiddenSet: new Set(hidden),
	list,
});

describe('useModelSlot', () => {
	it('falls back to the runtime default and reports that model’s levels', () => {
		const { result } = renderSlot(catalogueOf());

		expect(result.current.modelId).toBe('opus');
		expect(result.current.provider).toBe('claude');
		expect(result.current.levels).toEqual(['low', 'high']);
	});

	// The slot must never point at a model the visibility editor just hid — the
	// select would render an id it no longer lists.
	it('moves off a model that has been hidden', () => {
		const { result } = renderSlot(catalogueOf(['opus'], [PI_ONE]));

		expect(result.current.modelId).toBe('pi-one');
		expect(result.current.provider).toBe('pi');
	});

	// The Concierge slot persists the model's runtime as a second atom, and a
	// pair that disagrees is refused when that session opens.
	it('hands the chosen model’s runtime to onChoose', () => {
		const seen: Array<[string | null, string]> = [];
		const { result } = renderSlot(catalogueOf(), (modelId, provider) => {
			seen.push([modelId, provider]);
		});

		result.current.choose('pi-one');

		expect(seen).toEqual([['pi-one', 'pi']]);
	});

	it('reports no levels when nothing resolves', () => {
		const { result } = renderSlot({
			agentDefaultModelId: null,
			hiddenSet: new Set<string>(),
			list: [],
		});

		expect(result.current.modelId).toBeNull();
		expect(result.current.levels).toEqual([]);
	});
});
