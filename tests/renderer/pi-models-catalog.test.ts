import { describe, expect, test } from 'vitest';

import {
	advancePiModelsPoll,
	initialPiModelsPollState,
	isMissingProviderSubset,
	PI_MODELS_POLL_MS,
	type PiModelsPollState,
} from '../../src/renderer/api/ensemblr/pi-models-catalog';
import type { ListPiModelsResult } from '../../src/shared/ipc/contracts/pi-session';

/** Builds a catalog from `provider/model` id strings, one model per id. */
function catalog(ids: readonly string[]): ListPiModelsResult {
	return {
		defaultModelId: ids[0] ?? null,
		defaultThinkingLevel: ids.length > 0 ? 'medium' : null,
		models: ids.map((id) => ({
			displayName: id,
			id,
			provider: id.split('/')[0] ?? 'other',
			thinkingLevels: ['off', 'medium', 'high'],
		})),
	};
}

const FULL = catalog([
	'anthropic/claude-opus-4-8',
	'openai-codex/gpt-5.6-sol',
	'lmstudio/qwen',
]);
const MISSING_GPT = catalog(['anthropic/claude-opus-4-8', 'lmstudio/qwen']);

describe('isMissingProviderSubset', () => {
	test('flags a listing that drops a whole provider', () => {
		expect(isMissingProviderSubset(MISSING_GPT, FULL)).toBe(true);
	});

	test('allows an identical provider set (model churn within providers)', () => {
		const fewerModelsSameProviders = catalog([
			'anthropic/claude-opus-4-8',
			'openai-codex/gpt-5.6-sol',
			'lmstudio/qwen',
			'lmstudio/gemma',
		]);
		expect(isMissingProviderSubset(FULL, fewerModelsSameProviders)).toBe(false);
	});

	test('allows a listing that introduces a new provider', () => {
		const withGemini = catalog(['anthropic/claude-opus-4-8', 'gemini/pro']);
		expect(isMissingProviderSubset(withGemini, FULL)).toBe(false);
	});

	test('allows a superset', () => {
		expect(isMissingProviderSubset(FULL, MISSING_GPT)).toBe(false);
	});
});

describe('advancePiModelsPoll', () => {
	/** Drives the poll across a sequence of catalogs, returning each interval. */
	function run(sequence: readonly (ListPiModelsResult | undefined)[]): {
		intervals: (number | false)[];
		state: PiModelsPollState;
	} {
		let state = initialPiModelsPollState();
		const intervals: (number | false)[] = [];
		for (const data of sequence) {
			const result = advancePiModelsPoll(data, state);
			intervals.push(result.intervalMs);
			state = result.state;
		}
		return { intervals, state };
	}

	test('keeps polling while the catalog is empty', () => {
		const { intervals } = run([undefined, catalog([])]);
		expect(intervals).toEqual([PI_MODELS_POLL_MS, PI_MODELS_POLL_MS]);
	});

	test('stops after the provider set is stable for two polls', () => {
		const { intervals } = run([MISSING_GPT, FULL, FULL, FULL]);
		// partial → full (changed, reset) → full (stable 1) → full (stable 2 → stop)
		expect(intervals).toEqual([
			PI_MODELS_POLL_MS,
			PI_MODELS_POLL_MS,
			PI_MODELS_POLL_MS,
			false,
		]);
	});

	test('resets stability when a provider arrives late', () => {
		const { intervals } = run([MISSING_GPT, MISSING_GPT, FULL, FULL, FULL]);
		expect(intervals).toEqual([
			PI_MODELS_POLL_MS,
			PI_MODELS_POLL_MS,
			PI_MODELS_POLL_MS,
			PI_MODELS_POLL_MS,
			false,
		]);
	});

	test('stops after the poll ceiling even when the catalog keeps flapping', () => {
		const flapping = Array.from({ length: 20 }, (_, index) =>
			index % 2 === 0 ? FULL : MISSING_GPT,
		);
		const { intervals } = run(flapping);
		expect(intervals).toContain(false);
		expect(intervals.indexOf(false)).toBeLessThan(flapping.length - 1);
	});
});
