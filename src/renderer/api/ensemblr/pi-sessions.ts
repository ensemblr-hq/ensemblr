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
	ensemblrQueryKeys,
	getEnsemblrApi,
	getEnsemblrApiOrNull,
} from './query-keys';

/**
 * Query options for the Pi model catalog. Seeds from the localStorage cache so
 * the catalog is available instantly on launch (`initialData`), then refetches
 * in the background (`initialDataUpdatedAt: 0` marks the seed stale). A
 * transient empty result (pi not ready) falls back to the cache so the picker
 * is never blanked mid-session. Fresh results are persisted by the query-cache
 * subscription in `query-client.ts`.
 */
export const piModelsQuery = queryOptions({
	initialData: () => readCachedPiModels(),
	initialDataUpdatedAt: 0,
	queryFn: async (): Promise<ListPiModelsResult> => {
		const result = await profileElectronIpcCall(
			{ channel: 'ensemblr:list-pi-models', usesDatabase: false },
			() => getEnsemblrApi().listPiModels(),
		);
		if (result.models.length === 0) {
			return readCachedPiModels() ?? result;
		}
		return result;
	},
	queryKey: ensemblrQueryKeys.piModels(),
	// Prettify display names by convention (Claude/GPT) for every consumer —
	// composer picker, default/review selects, visibility list. `id` and
	// `provider` stay raw so resolution, matching, and search are unaffected.
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
