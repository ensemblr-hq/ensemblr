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
 * Order the picker lists model families in. Neither `supportedModels()` nor the
 * pinned list is ordered for reading — the runtime returns aliases in its own
 * order and the pinned rows trail behind — so the catalog imposes one: the
 * newest line first, then the general-purpose ladder from most to least capable.
 */
const FAMILY_ORDER: readonly string[] = ['fable', 'opus', 'sonnet', 'haiku'];

/**
 * Rank given to a model whose id names no family in `FAMILY_ORDER`, sinking it
 * below every family the picker knows how to place.
 */
const UNKNOWN_FAMILY_RANK = FAMILY_ORDER.length;

/**
 * Weight a major version carries when versions collapse into one comparable
 * number, wide enough that no minor can outrank the major above it.
 */
const MAJOR_VERSION_WEIGHT = 1000;

/**
 * Effort levels the pinned models accept. `supportedModels()` never mentions
 * them, so there is no per-model list to narrow against and the full Claude
 * ladder is offered.
 */
const PINNED_THINKING_LEVELS: readonly string[] = CLAUDE_THINKING_LEVELS;

/**
 * What a canonical wire model id says about the model: which family it belongs
 * to, how it reads as a version, and how recent that version is.
 */
type ModelIdentity = {
	readonly family: string;
	readonly recency: number;
	readonly version: string;
};

/**
 * Splits a canonical wire model id into the family and version a picker row is
 * named and ordered by — `claude-opus-5[1m]` → `opus` 5,
 * `claude-haiku-4-5-20251001` → `haiku` 4.5.
 * @param modelId - The canonical id, when one is known.
 * @returns The parsed identity, or null when the id does not parse.
 */
function readModelIdentity(modelId: string | undefined): ModelIdentity | null {
	const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(modelId ?? '');
	const family = match?.[1];
	const major = match?.[2];
	if (!family || !major) {
		return null;
	}
	const minor = match?.[3];
	return {
		family,
		recency: Number(major) * MAJOR_VERSION_WEIGHT + Number(minor ?? 0),
		version: minor ? `${major}.${minor}` : major,
	};
}

/**
 * Turns a canonical wire model id into the version suffix a picker row needs —
 * `claude-opus-5[1m]` → `Opus 5`, `claude-haiku-4-5-20251001` → `Haiku 4.5`.
 * @param resolvedModel - The `resolvedModel` the runtime reported, when it did.
 * @returns The family and version, or null when the id does not parse.
 */
function readModelVersion(resolvedModel: string | undefined): string | null {
	const identity = readModelIdentity(resolvedModel);
	if (!identity) {
		return null;
	}
	const { family, version } = identity;
	return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}`;
}

/**
 * The wire id a row's family and version are read from. An alias reports the
 * canonical id it currently resolves to; a row whose `value` is already
 * canonical reports nothing, so the value stands in.
 * @param model - The row as the runtime reported it.
 * @returns The id to parse for naming and ordering.
 */
function readCanonicalId(model: ModelInfo): string {
	return model.resolvedModel ?? model.value;
}

/**
 * Names one release, ignoring how a given id spells it. Ids for the same release
 * differ by context-window qualifier and release date — `claude-opus-5[1m]` and
 * `claude-opus-5` are one model, as are `claude-haiku-4-5` and
 * `claude-haiku-4-5-20251001` — so identity, not the raw string, decides whether
 * two rows name the same thing.
 * @param modelId - The canonical id to key, when one is known.
 * @returns A key shared by every id naming that release, or null when unparsed.
 */
function readReleaseKey(modelId: string | undefined): string | null {
	const identity = readModelIdentity(modelId);
	return identity ? `${identity.family}-${identity.recency}` : null;
}

/**
 * Names a row after the model it resolves to. The runtime's own display names
 * drop the version and add a context-window qualifier — `Opus (1M context)`,
 * `Sonnet` — which reads as ambiguous next to the pinned rows, so the version
 * replaces both: every Opus is a 1M model, and saying so on one row implies the
 * others are not.
 * @param model - The row as the runtime reported it.
 * @returns The display name for the picker.
 */
function presentDisplayName(model: ModelInfo): string {
	return (
		readModelVersion(readCanonicalId(model)) ??
		(model.displayName || model.value)
	);
}

/**
 * A catalog entry carrying the sort keys read off its canonical id, so the
 * ordering pass does not have to re-parse ids it has already seen.
 */
type RankedModel = {
	readonly familyRank: number;
	readonly option: AgentModelOption;
	readonly recency: number;
};

/**
 * Pairs a catalog entry with where its canonical id places it in the picker.
 * @param option - The entry as the picker will receive it.
 * @param canonicalId - The wire id the entry's family and version are read from.
 * @returns The entry with its family and recency ranks attached.
 */
function rankModel(option: AgentModelOption, canonicalId: string): RankedModel {
	const identity = readModelIdentity(canonicalId);
	const familyRank = identity ? FAMILY_ORDER.indexOf(identity.family) : -1;
	return {
		familyRank: familyRank === -1 ? UNKNOWN_FAMILY_RANK : familyRank,
		option,
		recency: identity?.recency ?? 0,
	};
}

/**
 * Orders two catalog entries by family, then newest version first. Entries that
 * tie on both keep the order they were collected in, which leaves an alias
 * ahead of the pinned row naming the same release.
 * @param left - The entry being placed.
 * @param right - The entry it is compared against.
 * @returns A negative number when `left` sorts first, positive when `right` does.
 */
function compareModels(left: RankedModel, right: RankedModel): number {
	return left.familyRank - right.familyRank || right.recency - left.recency;
}

/**
 * Projects `Query.supportedModels()` onto the shared model-catalog wire shape,
 * tagged as Claude's so the picker can group and provider-lock them, adds the
 * pinned releases the runtime accepts but does not advertise, and orders the
 * result by family and version.
 *
 * Thinking levels come from each model's own `supportedEffortLevels`, not from
 * a shared enum: pi's levels and Claude's efforts overlap but are different
 * axes, and offering an effort a model would reject is worse than offering
 * fewer.
 * @param models - The models the runtime reported for this account.
 * @returns Catalog entries ordered by `FAMILY_ORDER`, newest version first.
 */
export function presentClaudeModels(
	models: readonly ModelInfo[],
): readonly AgentModelOption[] {
	const advertised = models.flatMap((model) =>
		model.value && model.value !== DEFAULT_MODEL_ALIAS
			? [
					rankModel(
						{
							agentProvider: 'claude' as const,
							displayName: presentDisplayName(model),
							id: model.value,
							provider: CLAUDE_INFERENCE_PROVIDER,
							thinkingLevels: toThinkingLevels(model.supportedEffortLevels),
						},
						readCanonicalId(model),
					),
				]
			: [],
	);

	// An alias and its pinned twin are the same model to the runtime, so a pinned
	// row is dropped once an alias already resolves to it — otherwise picking
	// "Opus 4.8" and "Opus (1M context)" would silently mean the same thing.
	const covered = new Set(
		models.flatMap((model) => {
			const key = readReleaseKey(readCanonicalId(model));
			return key ? [key] : [];
		}),
	);

	const pinned = PINNED_MODELS.filter(
		(model) => !covered.has(readReleaseKey(model.id) ?? model.id),
	).map((model) =>
		rankModel(
			{
				agentProvider: 'claude' as const,
				displayName: model.displayName,
				id: model.id,
				provider: CLAUDE_INFERENCE_PROVIDER,
				thinkingLevels: PINNED_THINKING_LEVELS,
			},
			model.id,
		),
	);

	return [...advertised, ...pinned]
		.sort(compareModels)
		.map((ranked) => ranked.option);
}
