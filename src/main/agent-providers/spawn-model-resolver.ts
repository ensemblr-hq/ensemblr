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
 * Explicit spawns may cross the runtime axis only when the user opts in. An
 * omitted model still inherits on the caller's runtime, and a caller whose
 * runtime cannot be determined must name a model rather than receiving a default
 * nobody chose.
 */
import { classifyAgentModelTier } from '../../shared/agent-model-tier.ts';
import {
	type AgentProviderId,
	getAgentProviderLabel,
	listAgentProviderIds,
} from '../../shared/agent-provider.ts';
import {
	getThinkingAxisLabel,
	listThinkingLevels,
} from '../../shared/agent-thinking.ts';
import type { AgentModelOption } from '../../shared/ipc/contracts/agent-models.ts';
import type { ModelRoleAssignment } from '../../shared/model-role.ts';
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
	/** Agent runtime the child is pinned to after policy validation. */
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

/** The models one caller may spawn a child on, plus its current runtime policy. */
export interface SpawnModelListing {
	allowedRuntimes: readonly AgentProviderId[];
	callerRuntime: AgentProviderId | null;
	crossRuntimeDelegationEnabled: boolean;
	defaultModelId: string | null;
	models: readonly AgentModelOption[];
	roleAssignments: readonly ModelRoleAssignment[];
}

/** Resolves and lists the models a delegated conversation may be opened with. */
export interface SpawnModelResolver {
	/**
	 * The models a caller may spawn on under the user's current runtime policy. A
	 * null runtime cannot be narrowed, so it gets every runtime and must pick.
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
	/** Whether native orchestrators may explicitly target another runtime. */
	readCrossRuntimeDelegationEnabled: () => boolean;
	/** Reads model ids the user currently excludes from delegated spawns. */
	readHiddenModelIds: () => readonly string[];
	/** Reads advisory role assignments, including temporarily unavailable models. */
	readModelRoleAssignments: () => readonly ModelRoleAssignment[];
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
 * Removes models the user has hidden from delegated spawn choices while
 * retaining the catalog default id so normal fallback ordering still applies.
 * @param snapshot - The complete global model catalog.
 * @param hiddenModelIds - Model ids currently hidden in app settings.
 * @returns The catalog available for explicit and fallback child selection.
 */
function withoutHiddenModels(
	snapshot: CatalogSnapshot,
	hiddenModelIds: readonly string[],
): CatalogSnapshot {
	const hidden = new Set(hiddenModelIds);
	return {
		defaultModelId: snapshot.defaultModelId,
		models: snapshot.models.filter((model) => !hidden.has(model.id)),
	};
}

/**
 * The models in scope for one caller: its own runtime's, or every runtime's when
 * the caller has none the app can name and therefore has to pick explicitly.
 * @param models - The catalog's models.
 * @param runtime - The runtime to narrow to, or null to leave every runtime's in.
 * @returns The models that caller may spawn a child on.
 */
function modelsOn(
	models: readonly AgentModelOption[],
	runtime: AgentProviderId | null,
): readonly AgentModelOption[] {
	return runtime === null
		? models
		: models.filter((option) => option.agentProvider === runtime);
}

/**
 * Lists the catalog rows the caller may explicitly target under current policy.
 * @param models - Available, non-hidden catalog rows.
 * @param callerRuntime - The caller's native runtime, when known.
 * @param allowCrossRuntime - Whether a native caller may target the other runtime.
 * @returns Every permitted explicit destination model.
 */
function availableModelsFor(
	models: readonly AgentModelOption[],
	callerRuntime: AgentProviderId | null,
	allowCrossRuntime: boolean,
): readonly AgentModelOption[] {
	return callerRuntime === null || allowCrossRuntime
		? models
		: modelsOn(models, callerRuntime);
}

/**
 * Why a named model could not be used. "No such model" is only true when the
 * caller has a listing to be sent to: each runtime's catalog degrades to nothing
 * on its own, so a `pi --list-models` that failed leaves a pi caller unable to
 * name any pi model — and sending it to `listModels` would hand it a listing
 * that is empty for the same reason. Emptiness is measured over
 * {@link availableModelsFor}, the set `listModelsFor` itself publishes, so the
 * claim stays true when cross-runtime delegation is on and the other runtime's
 * rows *are* on offer. Naming inheritance as the way out matters because a
 * caller's own model id is honoured even while the catalog cannot place it.
 * @param input - The requested id, the rows in scope, the caller's runtime, and the cross-runtime opt-in.
 * @returns Prose for the calling agent.
 */
function unavailableModelReason(input: {
	allowCrossRuntime: boolean;
	callerRuntime: AgentProviderId | null;
	models: readonly AgentModelOption[];
	requestedModelId: string;
}): string {
	const runtime = input.callerRuntime;
	const offered = availableModelsFor(
		input.models,
		runtime,
		input.allowCrossRuntime,
	);
	return runtime !== null && offered.length === 0
		? `Ensemblr currently lists no ${getAgentProviderLabel(runtime)} models, so "${input.requestedModelId}" cannot be matched and ensemblr_list_models has nothing to offer you either — that runtime's catalog is unreadable right now, or every one of its models is hidden in Settings → Models. Omit "model" to inherit this conversation's own, which still works, or tell the user to check Settings → Providers.`
		: `No model "${input.requestedModelId}" is available in this app. Call ensemblr_list_models and pass an id that appears there.`;
}

/**
 * Names destination runtimes the current policy permits, independently of model availability.
 * @param callerRuntime - The caller's native runtime, when known.
 * @param allowCrossRuntime - Whether a native caller may target the other runtime.
 * @returns Allowed native runtime identifiers.
 */
function allowedRuntimesFor(
	callerRuntime: AgentProviderId | null,
	allowCrossRuntime: boolean,
): readonly AgentProviderId[] {
	return callerRuntime === null || allowCrossRuntime
		? listAgentProviderIds()
		: [callerRuntime];
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
	const inScope = modelsOn(snapshot.models, runtime);
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
	readCrossRuntimeDelegationEnabled,
	readHiddenModelIds,
	readModelRoleAssignments,
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
	 * Honours an explicitly requested model when the current runtime policy allows
	 * its destination. A refused request is never coerced to another model.
	 */
	const resolveRequested = (input: {
		caller: SpawnCallerIdentity;
		models: readonly AgentModelOption[];
		requestedModelId: string;
		requestedThinkingLevel: string | null;
		allowCrossRuntime: boolean;
	}): SpawnModelResolution => {
		const model = input.models.find(
			(option) => option.id === input.requestedModelId,
		);
		if (!model) {
			return {
				ok: false,
				reason: unavailableModelReason({
					allowCrossRuntime: input.allowCrossRuntime,
					callerRuntime: input.caller.runtime,
					models: input.models,
					requestedModelId: input.requestedModelId,
				}),
			};
		}
		const callerRuntime = input.caller.runtime;
		if (
			callerRuntime !== null &&
			model.agentProvider !== callerRuntime &&
			!input.allowCrossRuntime
		) {
			return {
				ok: false,
				reason: `Model "${input.requestedModelId}" runs on the ${getAgentProviderLabel(model.agentProvider)} runtime, and this conversation runs on ${getAgentProviderLabel(callerRuntime)}. Cross-runtime delegation is off. Enable “Allow cross-runtime delegation” in Settings → Models, or call ensemblr_list_models and choose one of its currently allowed models. Omitting "model" still inherits yours.`,
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
		fallbackCatalog: CatalogSnapshot;
		requestedThinkingLevel: string | null;
		runtime: AgentProviderId;
	}): SpawnModelResolution => {
		const fallback = defaultModelFor(input.fallbackCatalog, input.runtime);
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
		listModelsFor: async (callerRuntime) => {
			const snapshot = withoutHiddenModels(
				await readCatalog(catalog),
				readHiddenModelIds(),
			);
			const crossRuntimeDelegationEnabled = readCrossRuntimeDelegationEnabled();
			return {
				allowedRuntimes: allowedRuntimesFor(
					callerRuntime,
					crossRuntimeDelegationEnabled,
				),
				callerRuntime,
				crossRuntimeDelegationEnabled,
				defaultModelId: defaultModelFor(snapshot, callerRuntime)?.id ?? null,
				models: availableModelsFor(
					snapshot.models,
					callerRuntime,
					crossRuntimeDelegationEnabled,
				),
				roleAssignments: readModelRoleAssignments(),
			};
		},
		resolveForSpawn: async ({
			caller,
			requestedModelId,
			requestedThinkingLevel,
		}) => {
			const snapshot = await readCatalog(catalog);
			const availableSnapshot = withoutHiddenModels(
				snapshot,
				readHiddenModelIds(),
			);
			if (requestedModelId) {
				return resolveRequested({
					allowCrossRuntime: readCrossRuntimeDelegationEnabled(),
					caller,
					models: availableSnapshot.models,
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
				fallbackCatalog: availableSnapshot,
				requestedThinkingLevel,
				runtime: caller.runtime,
			});
		},
	};
}
