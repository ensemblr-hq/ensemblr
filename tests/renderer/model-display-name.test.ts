/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';

import { formatModelDisplayName } from '../../src/renderer/lib/pi/model-display-name';

const H = '‑'; // non-breaking hyphen used to join GPT name parts

describe('formatModelDisplayName — Claude', () => {
	test.each([
		['claude-3-5-sonnet-20240620', 'Claude Sonnet 3.5 (20240620)'],
		['claude-3-5-haiku-20241022', 'Claude Haiku 3.5 (20241022)'],
		['claude-3-5-haiku-latest', 'Claude Haiku 3.5 (latest)'],
		['claude-3-haiku-20240307', 'Claude Haiku 3 (20240307)'],
		['claude-3-opus-20240229', 'Claude Opus 3 (20240229)'],
		['claude-fable-5', 'Claude Fable 5'],
		// Claude 4+ convention: tier, major, then minor OR date.
		['claude-sonnet-4-20250514', 'Claude Sonnet 4 (20250514)'],
		['claude-opus-4-8', 'Claude Opus 4.8'],
		['claude-opus-4-5-20251101', 'Claude Opus 4.5 (20251101)'],
		['claude-opus-4-1', 'Claude Opus 4.1'],
		['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
		// A `.0` minor reads as the bare major (Opus 4, not Opus 4.0).
		['claude-opus-4-0', 'Claude Opus 4'],
	])('%s → %s', (input, expected) => {
		expect(formatModelDisplayName(input)).toBe(expected);
	});
});

describe('formatModelDisplayName — GPT', () => {
	test.each([
		['gpt-5.5', `GPT${H}5.5`],
		['gpt-5.4', `GPT${H}5.4`],
		['gpt-5.4-mini', `GPT${H}5.4${H}Mini`],
		['gpt-5.3-codex-spark', `GPT${H}5.3${H}Codex${H}Spark`],
		['gpt', 'GPT'],
	])('%s → %s', (input, expected) => {
		expect(formatModelDisplayName(input)).toBe(expected);
	});
});

describe('formatModelDisplayName — fallback', () => {
	test.each([
		// Niche / local models keep their reported names verbatim.
		['google/gemma-4-26b-a4b', 'google/gemma-4-26b-a4b'],
		['deepseek-ai/deepseek-v3.1', 'deepseek-ai/deepseek-v3.1'],
		[
			'qwen/qwen3-coder-480b-a35b-instruct',
			'qwen/qwen3-coder-480b-a35b-instruct',
		],
		['openai/gpt-oss-120b', 'openai/gpt-oss-120b'],
		[' ', ' '],
		['', ''],
	])('%s is unchanged', (input, expected) => {
		expect(formatModelDisplayName(input)).toBe(expected);
	});
});
