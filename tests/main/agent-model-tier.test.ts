/**
 * Which models the spawn gate stops to ask about. The table is read off a
 * model's own name because no runtime publishes a price, so the two failure
 * modes worth pinning are opposite: promoting a model nobody meant to gate
 * (which makes ordinary delegation raise dialogs), and missing the flagship tier
 * because an id spells the family differently than the display name does.
 */
import { describe, expect, it } from 'vitest';

import {
	classifyAgentModelTier,
	isFrontierAgentModel,
} from '../../src/shared/agent-model-tier.ts';

describe('the frontier tier', () => {
	it.each([
		'claude-fable-5-1',
		'claude-fable-5',
		'fable',
		'fable[1m]',
		'anthropic/claude-fable-5',
		'openai/gpt-astra',
		'gpt-astra-2',
	])('claims %s', (id) => {
		expect(classifyAgentModelTier({ id })).toBe('frontier');
	});

	// A moving alias reports an id that says nothing about what it resolves to,
	// so the display name is read as well — otherwise the gate would wave through
	// the very row a picker labels "Fable 5.1".
	it('reads the display name when the id does not name the family', () => {
		expect(
			classifyAgentModelTier({ displayName: 'Fable 5.1', id: 'model-7' }),
		).toBe('frontier');
	});
});

describe('the standard tier', () => {
	// The user's own call: spawning a child on Opus is ordinary delegation, and
	// asking about it would make the gate noise rather than a decision.
	it.each([
		'opus',
		'opus[1m]',
		'claude-opus-5',
		'claude-opus-4-8',
		'sonnet',
		'claude-haiku-4-5-20251001',
		'anthropic/claude-sonnet-4',
		'openai/gpt-5',
		'ollama/gemma',
	])('leaves %s alone', (id) => {
		expect(classifyAgentModelTier({ id })).toBe('standard');
	});

	// Whole segments, not substrings: an unrecognised model must not be gated
	// because a frontier family name happens to sit inside one of its words.
	it('does not match a family name buried inside a word', () => {
		expect(isFrontierAgentModel({ id: 'fabletown-3' })).toBe(false);
		expect(isFrontierAgentModel({ id: 'orchestra-mini' })).toBe(false);
	});

	it('treats an id it cannot place as standard', () => {
		expect(classifyAgentModelTier({ displayName: null, id: 'mystery-1' })).toBe(
			'standard',
		);
	});
});
