/**
 * Which cost tier a model belongs to, so a spawn that would escalate onto the
 * costliest one can be put to the user before it runs.
 *
 * Neither runtime publishes a price. `pi --list-models` reports a provider, a
 * name, and a context window; Claude Code's `supportedModels()` reports a
 * display name and its effort ladder. So the tier is read off the model's own
 * name, which is the only signal both runtimes carry — and it is read
 * conservatively: an id this table does not recognise is `standard`, because
 * gating a spawn nobody meant to gate is worse than missing one.
 *
 * `frontier` is deliberately narrow. It names the flagship tier a user would
 * not expect an agent to reach for on its own — not "the good models". Opus,
 * Sonnet, and the GPT line are all `standard`: an agent spawning a child on one
 * of those is ordinary delegation and asking about it would be noise.
 */

/** Cost tiers a model can fall into, cheapest concern first. */
const AGENT_MODEL_TIERS = ['standard', 'frontier'] as const;

/** The cost tier of one model. */
export type AgentModelTier = (typeof AGENT_MODEL_TIERS)[number];

/**
 * Model families whose per-token cost puts them above ordinary delegation.
 * Matched as whole name segments rather than as substrings, so a family name
 * appearing inside another word cannot promote an unrelated model.
 *
 * Adding a family here is the whole change: every surface that gates, lists, or
 * describes the tier reads {@link classifyAgentModelTier}.
 */
const FRONTIER_MODEL_FAMILIES: readonly string[] = ['astra', 'fable'];

/**
 * Splits a model id or display name into lowercase alphanumeric segments —
 * `anthropic/claude-fable-5`, `fable[1m]`, and `Fable 5.1` all yield a `fable`
 * segment, while a hypothetical `fabletown` yields one segment and matches
 * nothing.
 * @param value - The id or display name to split.
 * @returns The name's segments, lowercased and without empties.
 */
function segmentsOf(value: string): readonly string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((segment) => segment.length > 0);
}

/**
 * The cost tier a model falls into. The display name is read as well as the id
 * because a runtime may advertise a moving alias whose id says nothing about
 * the family it currently resolves to.
 * @param model - The model's wire id and, when the catalog carries one, its display name.
 * @returns `frontier` for the flagship tier, `standard` for everything else.
 */
export function classifyAgentModelTier(model: {
	displayName?: string | null;
	id: string;
}): AgentModelTier {
	const segments = new Set([
		...segmentsOf(model.id),
		...segmentsOf(model.displayName ?? ''),
	]);
	return FRONTIER_MODEL_FAMILIES.some((family) => segments.has(family))
		? 'frontier'
		: 'standard';
}

/**
 * Whether a model is the costliest tier, and therefore whether a spawn onto it
 * that the caller did not already run on needs the user's approval.
 * @param model - The model's wire id and, when the catalog carries one, its display name.
 * @returns True when the model is `frontier`.
 */
export function isFrontierAgentModel(model: {
	displayName?: string | null;
	id: string;
}): boolean {
	return classifyAgentModelTier(model) === 'frontier';
}
