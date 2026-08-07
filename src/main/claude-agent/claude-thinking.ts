import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';

/**
 * Thinking levels Claude Code accepts, in Ensemblr's own vocabulary. Pi's enum
 * runs `off | low | medium | high | xhigh`; Claude's `EffortLevel` runs
 * `low | medium | high | xhigh | max`. The two overlap on four values but are
 * not the same axis, so each provider publishes its own list on its model
 * entries rather than the picker assuming one shared enum.
 */
export const CLAUDE_THINKING_LEVELS = [
	'off',
	'low',
	'medium',
	'high',
	'xhigh',
	'max',
] as const;

/** A thinking level selectable on a Claude model. */
export type ClaudeThinkingLevel = (typeof CLAUDE_THINKING_LEVELS)[number];

const EFFORT_BY_LEVEL = {
	high: 'high',
	low: 'low',
	max: 'max',
	medium: 'medium',
	xhigh: 'xhigh',
} satisfies Record<Exclude<ClaudeThinkingLevel, 'off'>, EffortLevel>;

/**
 * Maps a thinking level onto the SDK's effort setting. `off` maps to no effort
 * option plus a zero thinking budget, which is how the SDK expresses "do not
 * think"; every other level passes through to the matching `EffortLevel`.
 * @param level - Thinking level requested for the session or turn.
 * @returns The SDK effort level, or null when thinking should be disabled.
 */
export function toClaudeEffortLevel(
	level: string | null | undefined,
): EffortLevel | null {
	const trimmed = level?.trim();
	if (!trimmed || trimmed === 'off') {
		return null;
	}
	return trimmed in EFFORT_BY_LEVEL
		? EFFORT_BY_LEVEL[trimmed as Exclude<ClaudeThinkingLevel, 'off'>]
		: null;
}

/**
 * Narrows the levels a specific model advertises down to Ensemblr's list, so
 * the picker never offers an effort the model would reject. Models that do not
 * report effort support get `off` alone — they think at a fixed setting.
 * @param supportedEffortLevels - The model's `supportedEffortLevels`, when reported.
 * @returns The thinking levels to publish for this model.
 */
export function toThinkingLevels(
	supportedEffortLevels: readonly EffortLevel[] | undefined,
): readonly string[] {
	if (!supportedEffortLevels || supportedEffortLevels.length === 0) {
		return ['off'];
	}
	return [
		'off',
		...CLAUDE_THINKING_LEVELS.filter(
			(level) =>
				level !== 'off' && supportedEffortLevels.includes(level as EffortLevel),
		),
	];
}
