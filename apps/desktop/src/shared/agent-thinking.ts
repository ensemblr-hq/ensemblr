import type { AgentProviderId } from './agent-provider.ts';

/**
 * Pi's thinking levels, ascending. Matches `ThinkingLevel` in
 * `@earendil-works/pi-agent-core`; pi accepts any of these via `--thinking` and
 * the RPC `set_thinking_level` command.
 */
const PI_THINKING_LEVELS = [
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
] as const;

/**
 * Claude Code's effort levels, ascending, in Ensemblr's own vocabulary. The SDK's
 * `EffortLevel` runs `low | medium | high | xhigh | max`; `off` is Ensemblr's
 * name for "do not think", which the SDK expresses as no effort option plus a
 * zero thinking budget.
 *
 * The two runtimes overlap on four values but are not the same axis — pi has
 * `minimal` and no `max`, Claude the reverse — so each publishes its own list
 * rather than the picker assuming one shared enum.
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

const LEVELS_BY_PROVIDER = {
	claude: CLAUDE_THINKING_LEVELS,
	pi: PI_THINKING_LEVELS,
} satisfies Record<AgentProviderId, readonly string[]>;

const LABELS_BY_PROVIDER = {
	claude: {
		high: 'High',
		low: 'Low',
		max: 'Max',
		medium: 'Medium',
		off: 'No thinking',
		xhigh: 'Extra high',
	},
	pi: {
		high: 'High',
		low: 'Low',
		medium: 'Medium',
		minimal: 'Minimal',
		off: 'No thinking',
		xhigh: 'Extra high',
	},
} satisfies Record<AgentProviderId, Record<string, string>>;

/**
 * The dial a runtime steers, as a locale-neutral id. Pi steers a thinking
 * level; Claude Code steers an effort level that also governs how much work it
 * does per turn, so the picker names the axis the way the runtime's own docs
 * and CLI do. UI code translates this id rather than {@link
 * getThinkingAxisLabel}, which is English-only.
 */
export type ThinkingAxis = 'effort' | 'thinking';

const AXIS_BY_PROVIDER = {
	claude: 'effort',
	pi: 'thinking',
} satisfies Record<AgentProviderId, ThinkingAxis>;

const AXIS_LABELS = {
	effort: 'Effort',
	thinking: 'Thinking',
} satisfies Record<ThinkingAxis, string>;

/**
 * The canonical level list for one runtime, used when a model publishes none of
 * its own.
 * @param provider - Agent runtime whose vocabulary to read.
 * @returns The runtime's levels, ascending, starting at `off`.
 */
export function listThinkingLevels(
	provider: AgentProviderId,
): readonly string[] {
	return LEVELS_BY_PROVIDER[provider];
}

/**
 * User-facing name for one level in a runtime's vocabulary, falling back to the
 * raw id so a level a runtime adds later still renders as something.
 * @param provider - Agent runtime the level belongs to.
 * @param level - Raw level id reported by the runtime.
 * @returns The display label.
 */
export function getThinkingLevelLabel(
	provider: AgentProviderId,
	level: string,
): string {
	const labels: Record<string, string> = LABELS_BY_PROVIDER[provider];
	return labels[level] ?? level;
}

/**
 * Which dial one runtime steers, as an id a caller can translate.
 * @param provider - Agent runtime to describe.
 * @returns `thinking` for pi, `effort` for Claude Code.
 */
export function getThinkingAxis(provider: AgentProviderId): ThinkingAxis {
	return AXIS_BY_PROVIDER[provider];
}

/**
 * English name of the dial itself for one runtime. Renderer surfaces translate
 * {@link getThinkingAxis} instead, so a localised picker is not half English.
 * @param provider - Agent runtime to describe.
 * @returns `Thinking` or `Effort`.
 */
export function getThinkingAxisLabel(provider: AgentProviderId): string {
	return AXIS_LABELS[AXIS_BY_PROVIDER[provider]];
}
