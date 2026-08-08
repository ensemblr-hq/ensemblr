import type {
	EffortLevel,
	Query,
	ThinkingConfig,
} from '@anthropic-ai/claude-agent-sdk';

import {
	CLAUDE_THINKING_LEVELS,
	type ClaudeThinkingLevel,
} from '../../shared/agent-thinking.ts';

/**
 * Display mode that keeps a turn's reasoning readable. A non-interactive
 * session — which every SDK session is — has its thinking display forced to
 * `omitted` unless it names one, and an omitted block reaches the timeline with
 * its prose stripped and only a signature left. Ensemblr renders reasoning, so
 * it asks for the summary every time.
 */
export const CLAUDE_THINKING_DISPLAY = 'summarized';

/**
 * The `thinking` option every Claude session opens with, whatever level the
 * chat is set to. It is unconditional because the option becomes a `--thinking`
 * flag on the CLI's argv, and a session that opened `disabled` can never be
 * talked back out of it: neither `applyFlagSettings` nor `setMaxThinkingTokens`
 * lifts the flag, so its chat could never turn reasoning on again.
 * {@link CLAUDE_THINKING_OFF_BUDGET} is what expresses "off" instead.
 */
export const CLAUDE_THINKING_CONFIG: ThinkingConfig = {
	display: CLAUDE_THINKING_DISPLAY,
	type: 'adaptive',
};

/**
 * Thinking budget that means "do not think". The `maxThinkingTokens` family is
 * deprecated in favour of the `thinking` option, but it is the only lever that
 * still moves a live session — read as on/off, where zero disables and any
 * other value restores adaptive thinking.
 */
export const CLAUDE_THINKING_OFF_BUDGET = 0;

const EFFORT_BY_LEVEL = {
	high: 'high',
	low: 'low',
	max: 'max',
	medium: 'medium',
	xhigh: 'xhigh',
} satisfies Record<Exclude<ClaudeThinkingLevel, 'off'>, EffortLevel>;

/**
 * Maps a thinking level onto the SDK's effort setting. `off` maps to no effort
 * option, leaving {@link steerClaudeThinking} to zero the budget; every other
 * level passes through to the matching `EffortLevel`.
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
 * Steers a live session onto one thinking level, in whichever direction. Both
 * halves are needed: `effortLevel` says how hard to think and never whether to,
 * while the budget carries the switch — so a level change that only wrote the
 * effort would leave a chat set to `off` still reasoning. Re-naming the display
 * matters too, because a session that was zeroed carries none and the API
 * default strips the prose.
 * @param query - The live query to steer.
 * @param level - Thinking level the session should run at from here on.
 */
export async function steerClaudeThinking(
	query: Pick<Query, 'applyFlagSettings' | 'setMaxThinkingTokens'>,
	level: string | null | undefined,
): Promise<void> {
	const effort = toClaudeEffortLevel(level);
	await query.applyFlagSettings({ effortLevel: effort });
	await (effort
		? query.setMaxThinkingTokens(null, CLAUDE_THINKING_DISPLAY)
		: query.setMaxThinkingTokens(CLAUDE_THINKING_OFF_BUDGET));
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
