/**
 * Decides which model, agent runtime, and thinking level a delegated child
 * conversation runs on.
 *
 * This lives beside the model catalog rather than in the agent-control layer on
 * purpose: control is a permission gate that delegates through ports and adds no
 * capability of its own, and "which runtime owns this model id" is the same
 * question `agent-model-catalog.ts` already answers for the renderer's open
 * request. Keeping one answer here is what stops the two spawn routes — a user
 * opening a chat, an orchestrator delegating one — from disagreeing about which
 * runtime a model belongs to.
 *
 * The invariant the whole module exists to hold: a spawn never crosses the agent
 * runtime axis. A Claude orchestrator's child runs on Claude, a Pi
 * orchestrator's on Pi, and a caller whose runtime cannot be determined is told
 * to name a model rather than quietly handed Pi's default.
 */
import { classifyAgentModelTier } from '../../shared/agent-model-tier.ts';
import {
	type AgentProviderId,
	getAgentProviderLabel,
} from '../../shared/agent-provider.ts';
import {
	getThinkingAxisLabel,
	listThinkingLevels,
} from '../../shared/agent-thinking.ts';
import type { AgentModelOption } from '../../shared/ipc/contracts/agent-models.ts';
import type { AgentModelCatalogService } from './agent-model-catalog.ts';

/**
 * Level a spawn settles on when neither the request nor the caller names one the
 * child's model accepts. It is the one rung both runtimes' ladders publish, so a
 * child always persists a level its own composer can render rather than the
 * user's default from the other runtime's vocabulary.
 */
const FALLBACK_THINKING_LEVEL = 'medium';

/** What a spawned conversation should be opened with. */
export interface SpawnModelSelection {
	modelId: string;
	/** Agent runtime the child is pinned to; never the caller's opposite. */
	runtime: AgentProviderId;
	thinkingLevel: string | null;
}

/**
 * The outcome of resolving a spawn. A refusal carries prose meant for the
 * calling agent, so it can correct the call on its next turn instead of reading
 * a generic failure.
 */
export type SpawnModelResolution =
	| { ok: true; selection: SpawnModelSelection }
	| { ok: false; reason: string };

/**
 * The spawning agent's own identity. `runtime` is null only for a caller the app
 * cannot place on a first-class runtime — a terminal harness, whose control
 * origin is shared by every terminal in its workspace.
 *
 * The two model fields differ in freshness, not in trust. `liveModelId` is what
 * the caller's own runtime reports it is running *now* and wins whenever the
 * catalog recognises it, because an agent that switched model inside its runtime
 * updates no session row until its next prompt goes through Ensemblr.
 * `sessionModelId` is the persisted row, which is the only thing a caller with no
 * live bridge has.
 */
export interface SpawnCallerIdentity {
	liveModelId: string | null;
	runtime: AgentProviderId | null;
	sessionModelId: string | null;
	thinkingLevel: string | null;
}

/** The models one caller may spawn a child on, plus which of them is default. */
export interface SpawnModelListing {
	defaultModelId: string | null;
	models: readonly AgentModelOption[];
	runtime: AgentProviderId | null;
}

/** Resolves and lists the models a delegated conversation may be opened with. */
export interface SpawnModelResolver {
	/**
	 * The models a caller on `runtime` may spawn a child on. A null runtime cannot
	 * be narrowed, so it gets every runtime's models and has to pick explicitly.
	 */
	listModelsFor: (
		runtime: AgentProviderId | null,
	) => Promise<SpawnModelListing>;
	resolveForSpawn: (input: {
		caller: SpawnCallerIdentity;
		requestedModelId: string | null;
		requestedThinkingLevel: string | null;
	}) => Promise<SpawnModelResolution>;
}

/** Collaborators for {@link createSpawnModelResolver}. */
export interface CreateSpawnModelResolverOptions {
	catalog: AgentModelCatalogService;
}

/** Every known model plus the id the catalog itself calls default. */
interface CatalogSnapshot {
	defaultModelId: string | null;
	models: readonly AgentModelOption[];
}

/**
 * Reads the merged catalog, degrading an unreadable one to an empty snapshot
 * rather than throwing: a spawn that can still inherit the caller's own model
 * must not be blocked by a `pi --list-models` that timed out.
 * @param catalog - The merged per-runtime model catalog.
 * @returns The catalog's models and default, or an empty snapshot when it could not be read.
 */
async function readCatalog(
	catalog: AgentModelCatalogService,
): Promise<CatalogSnapshot> {
	try {
		const { defaultModelId, models } = await catalog.list();
		return { defaultModelId, models };
	} catch (cause) {
		console.warn('[agent-models] the catalog was unreadable during a spawn.', {
			cause: cause instanceof Error ? cause.message : String(cause),
		});
		return { defaultModelId: null, models: [] };
	}
}

/**
 * The models in scope for one caller: its own runtime's, or every runtime's when
 * the caller has none the app can name and therefore has to pick explicitly.
 * @param snapshot - The catalog's models.
 * @param runtime - The runtime to narrow to, or null to leave every runtime's in.
 * @returns The models that caller may spawn a child on.
 */
function modelsOn(
	snapshot: CatalogSnapshot,
	runtime: AgentProviderId | null,
): readonly AgentModelOption[] {
	return runtime === null
		? snapshot.models
		: snapshot.models.filter((option) => option.agentProvider === runtime);
}

/**
 * The model a caller on `runtime` lands on when it names none and has none to
 * inherit: the catalog's own default when that runtime publishes it, else that
 * runtime's first entry. Preferring the catalog's default is what keeps a spawn
 * on the model the app itself would open, rather than on whatever `pi
 * --list-models` happened to print first.
 *
 * The frontier tier is stepped over here, and only here. Claude's catalog orders
 * the most capable family first, so its declared default *is* the costliest
 * model — and a spawn reaching this branch is one where neither the caller nor
 * the orchestrator named anything, which is the one case where landing on that
 * tier is nobody's decision. A caller that wants it still gets it by naming it,
 * which is the path the user is asked to confirm.
 *
 * Both the spawn fallback and the default `listModels` publishes read this one
 * function, including for the null runtime a terminal harness has: an
 * unnarrowed listing that advertised the frontier row as its default would send
 * the one caller that must name a model straight into the gate.
 * @param snapshot - The catalog's models and its declared default.
 * @param runtime - The runtime the child is pinned to, or null when it has none.
 * @returns The default model in that scope, or undefined when it has none.
 */
function defaultModelFor(
	snapshot: CatalogSnapshot,
	runtime: AgentProviderId | null,
): AgentModelOption | undefined {
	const inScope = modelsOn(snapshot, runtime);
	const affordable = inScope.filter(
		(option) => classifyAgentModelTier(option) !== 'frontier',
	);
	const candidates = affordable.length > 0 ? affordable : inScope;
	return (
		candidates.find((option) => option.id === snapshot.defaultModelId) ??
		candidates[0]
	);
}

/**
 * The levels a child may be opened at: the model's own list when it publishes
 * one, else its runtime's canonical ladder. Exported because `listModels`
 * publishes the same ladder to the agent choosing a level, and two answers to
 * "which levels does this model take" is how a documented level gets refused.
 * @param model - The child's model, when the catalog knows it.
 * @param runtime - The runtime the child is pinned to. Defaults to the model's own.
 * @returns The acceptable thinking levels.
 */
export function acceptableThinkingLevels(
	model: AgentModelOption | undefined,
	runtime?: AgentProviderId,
): readonly string[] {
	const published = model?.thinkingLevels ?? [];
	if (published.length > 0) {
		return published;
	}
	const owner = runtime ?? model?.agentProvider;
	return owner ? listThinkingLevels(owner) : [];
}

/**
 * Picks the child's thinking level: what the orchestrator asked for, else what
 * the orchestrator itself runs at, else the shared fallback — each accepted only
 * if the child's own runtime has that rung. A level from the other runtime's
 * vocabulary (`max` on Pi, `minimal` on Claude) is dropped rather than persisted
 * as something the child's composer cannot resolve.
 * @param input - The candidates in priority order and the levels the child accepts.
 * @returns The level to open the child at, or null when none of them fit.
 */
function pickThinkingLevel(input: {
	candidates: readonly (string | null)[];
	levels: readonly string[];
}): string | null {
	const accepted = new Set(input.levels);
	return (
		input.candidates.find(
			(candidate): candidate is string =>
				candidate !== null && accepted.has(candidate),
		) ?? null
	);
}

/**
 * Builds the resolver over the merged model catalog.
 * @param options - The catalog every runtime's models are read from.
 * @returns A {@link SpawnModelResolver}.
 */
export function createSpawnModelResolver({
	catalog,
}: CreateSpawnModelResolverOptions): SpawnModelResolver {
	const selectionFor = (input: {
		model: AgentModelOption | undefined;
		modelId: string;
		runtime: AgentProviderId;
		caller: SpawnCallerIdentity;
		requestedThinkingLevel: string | null;
	}): SpawnModelResolution => {
		const levels = acceptableThinkingLevels(input.model, input.runtime);
		const requested = input.requestedThinkingLevel;
		if (requested !== null && !levels.includes(requested)) {
			return {
				ok: false,
				reason: `Model "${input.modelId}" does not accept the ${getThinkingAxisLabel(input.runtime).toLowerCase()} level "${requested}". It accepts: ${levels.join(', ')}. The ${getAgentProviderLabel(input.runtime)} runtime's ladder is not the other one's — pass a level from this list, or omit "thinkingLevel" to inherit yours.`,
			};
		}
		return {
			ok: true,
			selection: {
				modelId: input.modelId,
				runtime: input.runtime,
				thinkingLevel: pickThinkingLevel({
					candidates: [
						requested,
						input.caller.thinkingLevel,
						FALLBACK_THINKING_LEVEL,
					],
					levels,
				}),
			},
		};
	};

	/**
	 * Honours an explicitly requested model, but only when it belongs to the
	 * caller's own runtime. A cross-runtime request is refused by name rather than
	 * coerced, because silently substituting another model is how an orchestrator
	 * ends up believing its children run something they do not.
	 */
	const resolveRequested = (input: {
		caller: SpawnCallerIdentity;
		models: readonly AgentModelOption[];
		requestedModelId: string;
		requestedThinkingLevel: string | null;
	}): SpawnModelResolution => {
		const model = input.models.find(
			(option) => option.id === input.requestedModelId,
		);
		if (!model) {
			return {
				ok: false,
				reason: `No model "${input.requestedModelId}" is available in this app. Call ensemblr_list_models and pass an id that appears there.`,
			};
		}
		const callerRuntime = input.caller.runtime;
		if (callerRuntime !== null && model.agentProvider !== callerRuntime) {
			return {
				ok: false,
				reason: `Model "${input.requestedModelId}" runs on the ${getAgentProviderLabel(model.agentProvider)} runtime, and this conversation runs on ${getAgentProviderLabel(callerRuntime)}. A spawned child cannot cross runtimes: call ensemblr_list_models, which lists only the ${getAgentProviderLabel(callerRuntime)} models you may spawn on, and pass one of those — or omit "model" to inherit yours.`,
			};
		}
		return selectionFor({
			caller: input.caller,
			model,
			modelId: input.requestedModelId,
			requestedThinkingLevel: input.requestedThinkingLevel,
			runtime: model.agentProvider,
		});
	};

	/**
	 * The caller's own model, in freshness order: the live one its runtime
	 * forwarded when the catalog places it on the caller's runtime, else the
	 * persisted session row. A row the catalog cannot place is still inherited,
	 * because the caller's runtime came from the control origin rather than from
	 * the model id — but one the catalog places on the *other* runtime is dropped,
	 * so a mislabelled session row cannot smuggle a model across.
	 */
	const inheritableModel = (input: {
		caller: SpawnCallerIdentity;
		models: readonly AgentModelOption[];
		runtime: AgentProviderId;
	}): { model: AgentModelOption | undefined; modelId: string } | null => {
		const live = input.models.find(
			(option) => option.id === input.caller.liveModelId,
		);
		if (live && live.agentProvider === input.runtime) {
			return { model: live, modelId: live.id };
		}
		const persisted = input.caller.sessionModelId;
		const persistedModel = input.models.find(
			(option) => option.id === persisted,
		);
		if (
			persisted &&
			(persistedModel === undefined ||
				persistedModel.agentProvider === input.runtime)
		) {
			return { model: persistedModel, modelId: persisted };
		}
		return null;
	};

	/**
	 * Resolves a spawn that named no model: the caller's own model, else the
	 * catalog's default for the caller's runtime.
	 */
	const resolveInherited = (input: {
		caller: SpawnCallerIdentity;
		catalog: CatalogSnapshot;
		requestedThinkingLevel: string | null;
		runtime: AgentProviderId;
	}): SpawnModelResolution => {
		const fallback = defaultModelFor(input.catalog, input.runtime);
		const inherited =
			inheritableModel({
				caller: input.caller,
				models: input.catalog.models,
				runtime: input.runtime,
			}) ?? (fallback ? { model: fallback, modelId: fallback.id } : null);
		if (!inherited) {
			return {
				ok: false,
				reason: `No ${getAgentProviderLabel(input.runtime)} models are available, so this conversation has nothing to spawn a child on. Check that runtime's setup in Settings → Providers.`,
			};
		}
		return selectionFor({
			caller: input.caller,
			model: inherited.model,
			modelId: inherited.modelId,
			requestedThinkingLevel: input.requestedThinkingLevel,
			runtime: input.runtime,
		});
	};

	return {
		listModelsFor: async (runtime) => {
			const snapshot = await readCatalog(catalog);
			return {
				defaultModelId: defaultModelFor(snapshot, runtime)?.id ?? null,
				models: modelsOn(snapshot, runtime),
				runtime,
			};
		},
		resolveForSpawn: async ({
			caller,
			requestedModelId,
			requestedThinkingLevel,
		}) => {
			const snapshot = await readCatalog(catalog);
			if (requestedModelId) {
				return resolveRequested({
					caller,
					models: snapshot.models,
					requestedModelId,
					requestedThinkingLevel,
				});
			}
			if (caller.runtime === null) {
				return {
					ok: false,
					reason:
						'This caller is not bound to one of Ensemblr\'s agent runtimes, so a child cannot inherit its model. Call ensemblr_list_models and pass an explicit "model" id from that list.',
				};
			}
			return resolveInherited({
				caller,
				catalog: snapshot,
				requestedThinkingLevel,
				runtime: caller.runtime,
			});
		},
	};
}
