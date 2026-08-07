import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';

import { CLAUDE_THINKING_LEVELS } from '../../shared/agent-thinking.ts';
import type { AgentModelOption } from '../../shared/ipc/contracts/agent-models';
import { toThinkingLevels } from './claude-thinking.ts';

/**
 * Inference provider stamped on every Claude Code model. Claude Code model ids
 * (`sonnet`, `opus[1m]`, …) carry no provider segment, so the picker's grouping
 * key is supplied here rather than parsed out of the id.
 */
const CLAUDE_INFERENCE_PROVIDER = 'claude-code';

/**
 * Model id the SDK uses for "whatever Claude Code would pick". It is a real,
 * selectable option, but it is not a model the user can reason about, so it is
 * dropped from the picker rather than shown alongside named models.
 */
const DEFAULT_MODEL_ALIAS = 'default';

/**
 * Previous-generation models Claude Code accepts as an explicit `--model` id but
 * does not advertise from `supportedModels()`, which lists only the moving
 * aliases (`opus`, `sonnet`, …) that track the newest release. Pinning matters
 * when a chat needs a model whose behaviour is known rather than whichever one
 * the alias points at today.
 *
 * Ids come from the Claude model catalogue and each was verified to resolve
 * through this SDK; `claude-sonnet-4-8` is deliberately absent because no such
 * model exists — the Sonnet line runs 4.6 → 5. An entry the signed-in account
 * is not entitled to fails only when it is actually selected.
 */
const PINNED_MODELS = [
	{ displayName: 'Opus 4.8', id: 'claude-opus-4-8' },
	{ displayName: 'Opus 4.7', id: 'claude-opus-4-7' },
	{ displayName: 'Sonnet 4.6', id: 'claude-sonnet-4-6' },
] as const;

/**
 * Effort levels the pinned models accept. `supportedModels()` never mentions
 * them, so there is no per-model list to narrow against and the full Claude
 * ladder is offered.
 */
const PINNED_THINKING_LEVELS: readonly string[] = CLAUDE_THINKING_LEVELS;

/**
 * Turns a canonical wire model id into the version suffix a picker row needs —
 * `claude-opus-5[1m]` → `Opus 5`, `claude-haiku-4-5-20251001` → `Haiku 4.5`.
 * @param resolvedModel - The `resolvedModel` the runtime reported, when it did.
 * @returns The family and version, or null when the id does not parse.
 */
function readModelVersion(resolvedModel: string | undefined): string | null {
	const match = /^claude-([a-z]+)-(\d+(?:-\d+)?)/.exec(resolvedModel ?? '');
	const family = match?.[1];
	const version = match?.[2];
	if (!family || !version) {
		return null;
	}
	return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.replace('-', '.')}`;
}

/**
 * Names an alias row after the model it currently resolves to. The runtime's own
 * display names drop the version — `Opus (1M context)`, `Sonnet` — which reads
 * as ambiguous next to the pinned rows, so the version is folded in while any
 * qualifier the runtime added is kept.
 * @param model - The alias row as the runtime reported it.
 * @returns The display name for the picker.
 */
function presentDisplayName(model: ModelInfo): string {
	const fallback = model.displayName || model.value;
	const versioned = readModelVersion(model.resolvedModel);
	if (!versioned) {
		return fallback;
	}
	const qualifier = /\(([^)]+)\)/.exec(fallback)?.[1];
	return qualifier ? `${versioned} (${qualifier})` : versioned;
}

/**
 * Projects `Query.supportedModels()` onto the shared model-catalog wire shape,
 * tagged as Claude's so the picker can group and provider-lock them, then
 * appends the pinned releases the runtime accepts but does not advertise.
 *
 * Thinking levels come from each model's own `supportedEffortLevels`, not from
 * a shared enum: pi's levels and Claude's efforts overlap but are different
 * axes, and offering an effort a model would reject is worse than offering
 * fewer.
 * @param models - The models the runtime reported for this account.
 * @returns Catalog entries: the runtime's own, in its order, then the pinned ones.
 */
export function presentClaudeModels(
	models: readonly ModelInfo[],
): readonly AgentModelOption[] {
	const advertised = models.flatMap((model) =>
		model.value && model.value !== DEFAULT_MODEL_ALIAS
			? [
					{
						agentProvider: 'claude' as const,
						displayName: presentDisplayName(model),
						id: model.value,
						provider: CLAUDE_INFERENCE_PROVIDER,
						thinkingLevels: toThinkingLevels(model.supportedEffortLevels),
					},
				]
			: [],
	);

	// An alias and its pinned twin are the same model to the runtime, so a pinned
	// row is dropped once an alias already resolves to it — otherwise picking
	// "Opus 4.8" and "Opus (1M context)" would silently mean the same thing.
	const covered = new Set(
		models.flatMap((model) =>
			model.resolvedModel ? [model.resolvedModel] : [],
		),
	);

	return [
		...advertised,
		...PINNED_MODELS.filter((model) => !covered.has(model.id)).map((model) => ({
			agentProvider: 'claude' as const,
			displayName: model.displayName,
			id: model.id,
			provider: CLAUDE_INFERENCE_PROVIDER,
			thinkingLevels: PINNED_THINKING_LEVELS,
		})),
	];
}
