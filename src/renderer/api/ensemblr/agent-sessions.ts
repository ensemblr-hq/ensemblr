import { queryOptions } from '@tanstack/react-query';
import { formatModelDisplayName } from '@/renderer/lib/agent-timeline';
import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { AgentModelCatalog } from '@/shared/ipc/contracts/agent-models';
import type {
	AgentSessionEventBroadcast,
	ListAgentSessionEventsResult,
	ListAgentSessionsResult,
	OpenAgentSessionRequest,
	OpenAgentSessionResult,
	PiRawFrameBroadcast,
	StopAgentSessionRequest,
	StopAgentSessionResult,
	SubmitAgentPromptRequest,
	SubmitAgentPromptResult,
	WriteForkSummaryRequest,
	WriteForkSummaryResult,
} from '@/shared/ipc/contracts/agent-session';
import { readCachedAgentModels } from './agent-models-cache';
import {
	type AgentModelsPollState,
	advanceAgentModelsPoll,
	initialAgentModelsPollState,
	isMissingProviderSubset,
} from './agent-models-catalog';
import {
	ensemblrQueryKeys,
	getEnsemblrApi,
	getEnsemblrApiOrNull,
} from './query-keys';

// Process-lifetime progress of the post-launch catalog settling poll. The agent
// models query is a singleton, so a single module-scoped state tracks it; each
// `refetchInterval` evaluation advances it purely via `advanceAgentModelsPoll`.
// This heals launch only: once it settles (or hits the ceiling) the poll does
// not re-arm, so a mid-session `pi` restart relies on the subset fallback in
// `queryFn`, not on renewed polling.
let agentModelsPollState: AgentModelsPollState = initialAgentModelsPollState();

/**
 * Query options for the agent model catalog. Seeds from the localStorage cache
 * so the catalog is available instantly on launch (`initialData`), then refetches
 * in the background (`initialDataUpdatedAt: 0` marks the seed stale). A
 * transient empty result (pi not ready) falls back to the cache so the picker
 * is never blanked mid-session. A partial cold-start listing that drops whole
 * providers (Claude/GPT still resolving) also falls back to the richer cache,
 * and `refetchInterval` keeps polling until the catalog settles so the picker
 * heals without a manual visit to Settings. Fresh results are persisted by the
 * query-cache subscription in `query-client.ts`.
 */
export const agentModelsQuery = queryOptions({
	/** Seeds the catalog from the localStorage cache for an instant first paint. */
	initialData: () => readCachedAgentModels(),
	initialDataUpdatedAt: 0,
	/**
	 * Fetches the live agent model catalog over IPC. Falls back to the cached
	 * catalog on an empty result, and on a partial listing that merely drops
	 * providers the cache already has (a cold-start race), so the picker is
	 * never blanked by a transient sub-catalog.
	 */
	queryFn: async (): Promise<AgentModelCatalog> => {
		const result = await profileElectronIpcCall(
			{ channel: 'ensemblr:list-agent-models', usesDatabase: false },
			() => getEnsemblrApi().listAgentModels(),
		);
		const cached = readCachedAgentModels();
		if (result.models.length === 0) {
			return cached ?? result;
		}
		if (cached && isMissingProviderSubset(result, cached)) {
			return cached;
		}
		return result;
	},
	queryKey: ensemblrQueryKeys.agentModels(),
	// Poll after launch until the catalog settles, then stop. Repairs the case
	// where the first listing is empty/partial (pi not fully ready) and nothing
	// else would refetch it before the user navigates.
	/** Advances the settling poll, returning the next delay or `false` to stop. */
	refetchInterval: (query) => {
		const { intervalMs, state } = advanceAgentModelsPoll(
			query.state.data,
			agentModelsPollState,
		);
		agentModelsPollState = state;
		return intervalMs;
	},
	// Prettify display names by convention (Claude/GPT) for every consumer —
	// composer picker, default/review selects, visibility list. `id` and
	// `provider` stay raw so resolution, matching, and search are unaffected.
	/** Prettifies model display names for every consumer while leaving `id` and `provider` raw. */
	select: (data: AgentModelCatalog): AgentModelCatalog => ({
		...data,
		models: data.models.map((model) => ({
			...model,
			displayName: formatModelDisplayName(model.displayName),
		})),
	}),
	staleTime: 60_000,
});

/** Query options for the persisted agent sessions of a single workspace. */
export function agentSessionsForWorkspaceQuery(workspaceId: string) {
	return queryOptions({
		enabled: workspaceId.length > 0,
		queryFn: (): Promise<ListAgentSessionsResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-agent-sessions', usesDatabase: true },
				() => getEnsemblrApi().listAgentSessions({ workspaceId }),
			),
		queryKey: ensemblrQueryKeys.agentSessionsForWorkspace(workspaceId),
		staleTime: 2000,
	});
}

/** Opens (or attaches to) an agent session for the given workspace. */
export function openAgentSession(
	request: OpenAgentSessionRequest,
): Promise<OpenAgentSessionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:open-agent-session', usesDatabase: true },
		() => getEnsemblrApi().openAgentSession(request),
	);
}

/** Submits a prompt to an open agent session. */
export function submitAgentPrompt(
	request: SubmitAgentPromptRequest,
): Promise<SubmitAgentPromptResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:submit-agent-prompt', usesDatabase: true },
		() => getEnsemblrApi().submitAgentPrompt(request),
	);
}

/** Query options for the persisted agent events of a branch. */
export function agentSessionEventsQuery(branchId: string) {
	return queryOptions({
		enabled: branchId.length > 0,
		queryFn: (): Promise<ListAgentSessionEventsResult> =>
			profileElectronIpcCall(
				{
					channel: 'ensemblr:list-agent-session-events',
					usesDatabase: true,
				},
				() => getEnsemblrApi().listAgentSessionEvents({ branchId }),
			),
		queryKey: ensemblrQueryKeys.agentSessionEvents(branchId),
		staleTime: 0,
	});
}

/** Subscribes to live agent session event broadcasts. Returns an unsubscribe fn. */
export function subscribeAgentSessionEvents(
	listener: (event: AgentSessionEventBroadcast) => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	if (!api) {
		return () => undefined;
	}
	return api.onAgentSessionEvent(listener);
}

/**
 * Subscribes to the temporary debug feed of raw Pi JSONL frames. Used by the
 * debug panel to display unnormalized rx/tx lines. Returns an unsubscribe fn.
 */
export function subscribePiRawFrames(
	listener: (frame: PiRawFrameBroadcast) => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	if (!api) {
		return () => undefined;
	}
	return api.onPiRawFrame(listener);
}

/** Writes a fork summary markdown for a conversation branch. */
export function writeForkSummary(
	request: WriteForkSummaryRequest,
): Promise<WriteForkSummaryResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:write-fork-summary', usesDatabase: true },
		() => getEnsemblrApi().writeForkSummary(request),
	);
}

/** Aborts the in-flight turn of an open agent session. */
export function stopAgentSession(
	request: StopAgentSessionRequest,
): Promise<StopAgentSessionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:stop-agent-session', usesDatabase: true },
		() => getEnsemblrApi().stopAgentSession(request),
	);
}
