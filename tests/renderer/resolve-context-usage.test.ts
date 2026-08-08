import { describe, expect, test } from 'vitest';

import { resolveContextUsage } from '../../src/renderer/lib/workbench';
import type { ComposerModelOption } from '../../src/renderer/types/workbench';

const model = (contextWindow: number | null): ComposerModelOption => ({
	agentProvider: 'pi',
	contextWindow,
	displayName: 'Opus 5',
	id: 'anthropic/claude-opus-5',
	provider: 'anthropic',
});

describe('the gauge denominator before a session has measured one', () => {
	test('stands the selected model window in at zero occupancy', () => {
		expect(resolveContextUsage(null, model(1_000_000))).toEqual({
			maxTokens: 1_000_000,
			usedTokens: 0,
		});
	});

	test('a measurement from the session always wins over the catalog', () => {
		expect(
			resolveContextUsage(
				{ maxTokens: 200_000, usedTokens: 40_000 },
				model(1_000_000),
			),
		).toEqual({ maxTokens: 200_000, usedTokens: 40_000 });
	});

	test('stays unknown when the runtime publishes no window for the model', () => {
		expect(resolveContextUsage(null, model(null))).toBeNull();
	});

	test('stays unknown while no model is selected', () => {
		expect(resolveContextUsage(null, undefined)).toBeNull();
	});

	test('treats a zero window as no window rather than as a full gauge', () => {
		expect(resolveContextUsage(null, model(0))).toBeNull();
	});
});
