import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import { formatModelDisplayName } from '@/renderer/lib/pi/model-display-name';
import type {
	ListPiModelsResult,
	ListPiSessionEventsResult,
	ListPiSessionsResult,
	OpenPiSessionRequest,
	OpenPiSessionResult,
	PiRawFrameBroadcast,
	PiSessionEventBroadcast,
	StopPiSessionRequest,
	StopPiSessionResult,
	SubmitPiPromptRequest,
	SubmitPiPromptResult,
	WriteForkSummaryRequest,
	WriteForkSummaryResult,
} from '@/shared/ipc/contracts/pi-session';
import { readCachedPiModels } from './pi-models-cache';
import {
	advancePiModelsPoll,
	initialPiModelsPollState,
	isMissingProviderSubset,
	type PiModelsPollState,
} from './pi-models-catalog';
import {
	ensemblrQueryKeys,
	getEnsemblrApi,
	getEnsemblrApiOrNull,
} from './query-keys';

// Process-lifetime progress of the post-launch catalog settling poll. The Pi
// models query is a singleton, so a single module-scoped state tracks it; each
// `refetchInterval` evaluation advances it purely via `advancePiModelsPoll`.
let piModelsPollState: PiModelsPollState = initialPiModelsPollState();

/**
 * Query options for the Pi model catalog. Seeds from the localStorage cache so
 * the catalog is available instantly on launch (`initialData`), then refetches
 * in the background (`initialDataUpdatedAt: 0` marks the seed stale). A
 * transient empty result (pi not ready) falls back to the cache so the picker
 * is never blanked mid-session. A partial cold-start listing that drops whole
 * providers (Claude/GPT still resolving) also falls back to the richer cache,
 * and `refetchInterval` keeps polling until the catalog settles so the picker
 * heals without a manual visit to Settings. Fresh results are persisted by the
 * query-cache subscription in `query-client.ts`.
 */
export const piModelsQuery = queryOptions({
	/** Seeds the catalog from the localStorage cache for an instant first paint. */
	initialData: () => readCachedPiModels(),
	initialDataUpdatedAt: 0,
	/**
	 * Fetches the live Pi model catalog over IPC. Falls back to the cached
	 * catalog on an empty result, and on a partial listing that merely drops
	 * providers the cache already has (a cold-start race), so the picker is
	 * never blanked by a transient sub-catalog.
	 */
	queryFn: async (): Promise<ListPiModelsResult> => {
		const result = await profileElectronIpcCall(
			{ channel: 'ensemblr:list-pi-models', usesDatabase: false },
			() => getEnsemblrApi().listPiModels(),
		);
		const cached = readCachedPiModels();
		if (result.models.length === 0) {
			return cached ?? result;
		}
		if (cached && isMissingProviderSubset(result, cached)) {
			return cached;
		}
		return result;
	},
	queryKey: ensemblrQueryKeys.piModels(),
	// Poll after launch until the catalog settles, then stop. Repairs the case
	// where the first listing is empty/partial (pi not fully ready) and nothing
	// else would refetch it before the user navigates.
	/** Advances the settling poll, returning the next delay or `false` to stop. */
	refetchInterval: (query) => {
		const { intervalMs, state } = advancePiModelsPoll(
			query.state.data,
			piModelsPollState,
		);
		piModelsPollState = state;
		return intervalMs;
	},
	// Prettify display names by convention (Claude/GPT) for every consumer —
	// composer picker, default/review selects, visibility list. `id` and
	// `provider` stay raw so resolution, matching, and search are unaffected.
	/** Prettifies model display names for every consumer while leaving `id` and `provider` raw. */
	select: (data: ListPiModelsResult): ListPiModelsResult => ({
		...data,
		models: data.models.map((model) => ({
			...model,
			displayName: formatModelDisplayName(model.displayName),
		})),
	}),
	staleTime: 60_000,
});

/** Query options for the persisted Pi sessions of a single workspace. */
export function piSessionsForWorkspaceQuery(workspaceId: string) {
	return queryOptions({
		enabled: workspaceId.length > 0,
		queryFn: (): Promise<ListPiSessionsResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-pi-sessions', usesDatabase: true },
				() => getEnsemblrApi().listPiSessions({ workspaceId }),
			),
		queryKey: ensemblrQueryKeys.piSessionsForWorkspace(workspaceId),
		staleTime: 2000,
	});
}

/** Opens (or attaches to) a Pi session for the given workspace. */
export function openPiSession(
	request: OpenPiSessionRequest,
): Promise<OpenPiSessionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:open-pi-session', usesDatabase: true },
		() => getEnsemblrApi().openPiSession(request),
	);
}

/** Submits a prompt to an open Pi session. */
export function submitPiPrompt(
	request: SubmitPiPromptRequest,
): Promise<SubmitPiPromptResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:submit-pi-prompt', usesDatabase: true },
		() => getEnsemblrApi().submitPiPrompt(request),
	);
}

/** Query options for the persisted Pi events of a branch. */
export function piSessionEventsQuery(branchId: string) {
	return queryOptions({
		enabled: branchId.length > 0,
		queryFn: (): Promise<ListPiSessionEventsResult> =>
			profileElectronIpcCall(
				{
					channel: 'ensemblr:list-pi-session-events',
					usesDatabase: true,
				},
				() => getEnsemblrApi().listPiSessionEvents({ branchId }),
			),
		queryKey: ensemblrQueryKeys.piSessionEvents(branchId),
		staleTime: 0,
	});
}

/** Subscribes to live Pi RPC event broadcasts. Returns an unsubscribe fn. */
export function subscribePiSessionEvents(
	listener: (event: PiSessionEventBroadcast) => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	if (!api) {
		return () => undefined;
	}
	return api.onPiSessionEvent(listener);
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

/** Aborts the in-flight turn of an open Pi session. */
export function stopPiSession(
	request: StopPiSessionRequest,
): Promise<StopPiSessionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:stop-pi-session', usesDatabase: true },
		() => getEnsemblrApi().stopPiSession(request),
	);
}
