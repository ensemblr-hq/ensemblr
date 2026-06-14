import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { ListPiModelsResult, ListPiSessionEventsResult, ListPiSessionsResult, OpenPiSessionRequest, OpenPiSessionResult, PiRawFrameBroadcast, PiSessionEventBroadcast, StopPiSessionRequest, StopPiSessionResult, SubmitPiPromptRequest, SubmitPiPromptResult, WriteForkSummaryRequest, WriteForkSummaryResult } from '@/shared/ipc/contracts/pi-session';

import {
	ensembleQueryKeys,
	getEnsembleApi,
	getEnsembleApiOrNull,
} from './query-keys';

/** Query options for the static Pi model catalog. */
export const piModelsQuery = queryOptions({
	queryFn: (): Promise<ListPiModelsResult> =>
		profileElectronIpcCall(
			{ channel: 'ensemble:list-pi-models', usesDatabase: false },
			() => getEnsembleApi().listPiModels(),
		),
	queryKey: ensembleQueryKeys.piModels(),
	staleTime: 60_000,
});

/** Query options for the persisted Pi sessions of a single workspace. */
export function piSessionsForWorkspaceQuery(workspaceId: string) {
	return queryOptions({
		enabled: workspaceId.length > 0,
		queryFn: (): Promise<ListPiSessionsResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemble:list-pi-sessions', usesDatabase: true },
				() => getEnsembleApi().listPiSessions({ workspaceId }),
			),
		queryKey: ensembleQueryKeys.piSessionsForWorkspace(workspaceId),
		staleTime: 2000,
	});
}

/** Opens (or attaches to) a Pi session for the given workspace. */
export function openPiSession(
	request: OpenPiSessionRequest,
): Promise<OpenPiSessionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:open-pi-session', usesDatabase: true },
		() => getEnsembleApi().openPiSession(request),
	);
}

/** Submits a prompt to an open Pi session. */
export function submitPiPrompt(
	request: SubmitPiPromptRequest,
): Promise<SubmitPiPromptResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:submit-pi-prompt', usesDatabase: true },
		() => getEnsembleApi().submitPiPrompt(request),
	);
}

/** Query options for the persisted Pi events of a branch. */
export function piSessionEventsQuery(branchId: string) {
	return queryOptions({
		enabled: branchId.length > 0,
		queryFn: (): Promise<ListPiSessionEventsResult> =>
			profileElectronIpcCall(
				{
					channel: 'ensemble:list-pi-session-events',
					usesDatabase: true,
				},
				() => getEnsembleApi().listPiSessionEvents({ branchId }),
			),
		queryKey: ensembleQueryKeys.piSessionEvents(branchId),
		staleTime: 0,
	});
}

/** Subscribes to live Pi RPC event broadcasts. Returns an unsubscribe fn. */
export function subscribePiSessionEvents(
	listener: (event: PiSessionEventBroadcast) => void,
): () => void {
	const api = getEnsembleApiOrNull();
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
	const api = getEnsembleApiOrNull();
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
		{ channel: 'ensemble:write-fork-summary', usesDatabase: true },
		() => getEnsembleApi().writeForkSummary(request),
	);
}

/** Aborts the in-flight turn of an open Pi session. */
export function stopPiSession(
	request: StopPiSessionRequest,
): Promise<StopPiSessionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:stop-pi-session', usesDatabase: true },
		() => getEnsembleApi().stopPiSession(request),
	);
}
