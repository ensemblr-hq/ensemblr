import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { presentClaudeModels } from '../../src/main/claude-agent/claude-model-catalog.ts';

/** Builds a `supportedModels()` row with only the fields the catalog reads. */
function modelInfo(row: Partial<ModelInfo>): ModelInfo {
	return {
		description: '',
		displayName: '',
		value: '',
		...row,
	} as ModelInfo;
}

const ALIAS_ROWS: readonly ModelInfo[] = [
	modelInfo({
		displayName: 'Default (recommended)',
		resolvedModel: 'claude-opus-5[1m]',
		value: 'default',
	}),
	modelInfo({
		displayName: 'Opus (1M context)',
		resolvedModel: 'claude-opus-5[1m]',
		supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
		value: 'opus[1m]',
	}),
	modelInfo({
		displayName: 'Sonnet',
		resolvedModel: 'claude-sonnet-5',
		supportedEffortLevels: ['low', 'medium', 'high'],
		value: 'sonnet',
	}),
	modelInfo({
		displayName: 'Haiku',
		resolvedModel: 'claude-haiku-4-5-20251001',
		value: 'haiku',
	}),
];

describe('the Claude catalog names alias rows after what they resolve to', () => {
	it('folds the version in and keeps the runtime qualifier', () => {
		const byId = new Map(
			presentClaudeModels(ALIAS_ROWS).map((model) => [
				model.id,
				model.displayName,
			]),
		);

		expect(byId.get('opus[1m]')).toBe('Opus 5 (1M context)');
		expect(byId.get('sonnet')).toBe('Sonnet 5');
		expect(byId.get('haiku')).toBe('Haiku 4.5');
	});

	it('drops the `default` alias, which names no model the user can reason about', () => {
		expect(
			presentClaudeModels(ALIAS_ROWS).map((model) => model.id),
		).not.toContain('default');
	});

	it('falls back to the reported name when nothing resolves', () => {
		const models = presentClaudeModels([
			modelInfo({ displayName: 'Fable', value: 'claude-fable-5[1m]' }),
		]);

		expect(models[0]?.displayName).toBe('Fable');
	});

	it('publishes only the efforts a model reports', () => {
		const models = presentClaudeModels(ALIAS_ROWS);
		const sonnet = models.find((model) => model.id === 'sonnet');
		const haiku = models.find((model) => model.id === 'haiku');

		expect(sonnet?.thinkingLevels).toEqual(['off', 'low', 'medium', 'high']);
		expect(haiku?.thinkingLevels).toEqual(['off']);
	});
});

describe('the Claude catalog appends the pinned releases', () => {
	it('offers them after the runtime rows, on the full effort ladder', () => {
		const models = presentClaudeModels(ALIAS_ROWS);
		const pinned = models.find((model) => model.id === 'claude-opus-4-8');

		expect(models.at(-3)?.id).toBe('claude-opus-4-8');
		expect(pinned?.displayName).toBe('Opus 4.8');
		expect(pinned?.agentProvider).toBe('claude');
		expect(pinned?.thinkingLevels).toEqual([
			'off',
			'low',
			'medium',
			'high',
			'xhigh',
			'max',
		]);
	});

	it('drops a pinned row an alias already resolves to', () => {
		const models = presentClaudeModels([
			modelInfo({
				displayName: 'Opus',
				resolvedModel: 'claude-opus-4-8',
				value: 'opus',
			}),
		]);

		expect(models.filter((model) => model.id === 'claude-opus-4-8')).toEqual(
			[],
		);
		expect(models.map((model) => model.id)).toContain('opus');
	});
});
