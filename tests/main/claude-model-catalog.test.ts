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
	it('folds the version in and drops the context-window qualifier', () => {
		const byId = new Map(
			presentClaudeModels(ALIAS_ROWS).map((model) => [
				model.id,
				model.displayName,
			]),
		);

		expect(byId.get('opus[1m]')).toBe('Opus 5');
		expect(byId.get('sonnet')).toBe('Sonnet 5');
		expect(byId.get('haiku')).toBe('Haiku 4.5');
	});

	it('drops the `default` alias, which names no model the user can reason about', () => {
		expect(
			presentClaudeModels(ALIAS_ROWS).map((model) => model.id),
		).not.toContain('default');
	});

	it('names a row whose own value is already canonical', () => {
		const models = presentClaudeModels([
			modelInfo({ displayName: 'Fable', value: 'claude-fable-5[1m]' }),
		]);

		expect(models[0]?.displayName).toBe('Fable 5');
	});

	it('falls back to the reported name when no id parses', () => {
		const models = presentClaudeModels([
			modelInfo({ displayName: 'Research preview', value: 'preview' }),
		]);

		expect(models.find((model) => model.id === 'preview')?.displayName).toBe(
			'Research preview',
		);
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
	it('offers them among the runtime rows, on the full effort ladder', () => {
		const models = presentClaudeModels(ALIAS_ROWS);
		const pinned = models.find((model) => model.id === 'claude-opus-4-8');

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

	// The same release is spelled differently across ids — a context-window
	// qualifier here, a release date there — so the dedup keys on the release the
	// id names, not on the string.
	it('drops a pinned row an alias resolves to under another spelling', () => {
		const models = presentClaudeModels([
			modelInfo({
				displayName: 'Opus (1M context)',
				resolvedModel: 'claude-opus-4-8[1m]',
				value: 'opus[1m]',
			}),
			modelInfo({
				displayName: 'Sonnet',
				resolvedModel: 'claude-sonnet-4-6-20260114',
				value: 'sonnet',
			}),
		]);

		expect(models.map((model) => model.id)).toEqual([
			'opus[1m]',
			'claude-opus-4-7',
			'sonnet',
		]);
	});
});

describe('the Claude catalog orders models by family, then by version', () => {
	it('runs Fable, then Opus, Sonnet and Haiku, newest release first', () => {
		const models = presentClaudeModels([
			...ALIAS_ROWS,
			modelInfo({
				displayName: 'Fable',
				resolvedModel: 'claude-fable-5',
				value: 'fable',
			}),
		]);

		expect(models.map((model) => model.displayName)).toEqual([
			'Fable 5',
			'Opus 5',
			'Opus 4.8',
			'Opus 4.7',
			'Sonnet 5',
			'Sonnet 4.6',
			'Haiku 4.5',
		]);
	});

	it('sinks a row whose id names no known family below every named one', () => {
		const models = presentClaudeModels([
			modelInfo({ displayName: 'Research preview', value: 'preview' }),
			modelInfo({
				displayName: 'Haiku',
				resolvedModel: 'claude-haiku-4-5-20251001',
				value: 'haiku',
			}),
		]);

		expect(models.at(-1)?.id).toBe('preview');
	});
});
