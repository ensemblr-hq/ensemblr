import { describe, expect, test } from 'vitest';

import { showContextIndicator } from '../../src/renderer/lib/workbench';
import type { ComposerContextUsage } from '../../src/renderer/types/workbench';
import { createComposerShellState } from './support/composer';

const composerWith = (contextUsage: ComposerContextUsage | null) =>
	createComposerShellState({ contextUsage });

describe('context gauge visibility', () => {
	test('stays hidden well below the window limit', () => {
		expect(
			showContextIndicator(
				composerWith({ maxTokens: 200_000, usedTokens: 100_000 }),
				false,
			),
		).toBe(false);
	});

	test('appears once usage passes 70% of the window', () => {
		expect(
			showContextIndicator(
				composerWith({ maxTokens: 200_000, usedTokens: 160_000 }),
				false,
			),
		).toBe(true);
	});

	test('treats exactly 70% as still quiet', () => {
		expect(
			showContextIndicator(
				composerWith({ maxTokens: 200_000, usedTokens: 140_000 }),
				false,
			),
		).toBe(false);
	});

	test('follows the preference when usage is unknown', () => {
		expect(showContextIndicator(composerWith(null), false)).toBe(false);
		expect(showContextIndicator(composerWith(null), true)).toBe(true);
	});

	test('follows the preference when the window size is unusable', () => {
		const unusable = { maxTokens: 0, usedTokens: 4_000 };

		expect(showContextIndicator(composerWith(unusable), false)).toBe(false);
		expect(showContextIndicator(composerWith(unusable), true)).toBe(true);
	});

	test('the preference forces the gauge on at low usage', () => {
		expect(
			showContextIndicator(
				composerWith({ maxTokens: 200_000, usedTokens: 1_000 }),
				true,
			),
		).toBe(true);
	});
});
