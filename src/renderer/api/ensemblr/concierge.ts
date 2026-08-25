import { queryOptions } from '@tanstack/react-query';
import { mergeConciergeEvents } from '@/renderer/lib/concierge';
import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	ClearConciergeContextRequest,
	ClearConciergeContextResult,
	ConciergeContextPressureWire,
	ConciergeEventBroadcastWire,
	ListConciergeArtifactsResult,
	ListConciergeEventsResult,
	OpenConciergeSessionRequest,
	OpenConciergeSessionResult,
	StopConciergeSessionRequest,
	StopConciergeSessionResult,
	SubmitConciergePromptRequest,
	SubmitConciergePromptResult,
} from '@/shared/ipc/contracts/concierge';
import {
	ensemblrQueryKeys,
	getEnsemblrApi,
	getEnsemblrApiOrNull,
} from './query-keys';

/**
 * Query options for the Concierge transcript.
 *
 * `staleTime: Infinity` because the transcript only ever grows and live events
 * arrive over the broadcast — refetching would re-read rows the cache already
 * holds. A null session id disables the query rather than fetching nothing.
 * @param sessionId - Concierge session to read, or null before one is open.
 * @returns Query options for the transcript.
 */
export const conciergeEventsQuery = (sessionId: string | null) =>
	queryOptions({
		enabled: sessionId !== null,
		/**
		 * Reads the persisted Concierge transcript over IPC, merged with whatever
		 * the broadcast wrote into this key while the read was in flight — panel
		 * opened onto a streaming turn, those events would otherwise be replaced
		 * wholesale by the fetch and nothing would ever refetch to repair the hole.
		 */
		queryFn: async ({ client }): Promise<ListConciergeEventsResult> => {
			if (!sessionId) {
				return { events: [] };
			}
			const fetched = await profileElectronIpcCall(
				{ channel: 'ensemblr:list-concierge-events', usesDatabase: true },
				() => getEnsemblrApi().listConciergeEvents({ sessionId }),
			);
			const live = client.getQueryData<ListConciergeEventsResult>(
				ensemblrQueryKeys.conciergeEvents(sessionId),
			);
			return {
				events: mergeConciergeEvents(fetched.events, live?.events ?? []),
			};
		},
		queryKey: ensemblrQueryKeys.conciergeEvents(sessionId ?? ''),
		staleTime: Number.POSITIVE_INFINITY,
	});

/**
 * Query options for how full the Concierge's context is.
 *
 * Polled rather than pushed: usage moves only while a turn streams, and a
 * banner that appears a few seconds late costs nothing, whereas a broadcast per
 * usage event would be one more channel for a number nobody reads between turns.
 */
export const conciergeContextPressureQuery = queryOptions({
	/** Reads the Concierge's context pressure over IPC. */
	queryFn: async (): Promise<ConciergeContextPressureWire> =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:concierge-context-pressure', usesDatabase: false },
			() => getEnsemblrApi().conciergeContextPressure(),
		),
	queryKey: ensemblrQueryKeys.conciergeContextPressure(),
	refetchInterval: 15_000,
});

/**
 * Opens or resumes the Concierge session.
 * @param request - Whether to force a new session rather than resume.
 * @returns The opened session, or the error that stopped it.
 */
export async function openConciergeSession(
	request: OpenConciergeSessionRequest = {},
): Promise<OpenConciergeSessionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:open-concierge-session', usesDatabase: true },
		() => getEnsemblrApi().openConciergeSession(request),
	);
}

/**
 * Submits a prompt to the open Concierge session.
 * @param request - Session id, prompt, and any per-turn model override.
 * @returns Acceptance, or the error that stopped it.
 */
export async function submitConciergePrompt(
	request: SubmitConciergePromptRequest,
): Promise<SubmitConciergePromptResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:submit-concierge-prompt', usesDatabase: false },
		() => getEnsemblrApi().submitConciergePrompt(request),
	);
}

/**
 * Query options for the Concierge's artifacts.
 *
 * Kept briefly stale rather than cached forever: the Concierge writes these
 * itself mid-conversation, so an `@` menu opened right after it said "written to
 * `artifacts/plan.md`" has to be able to offer the file it just named.
 */
export const conciergeArtifactsQuery = queryOptions({
	/** Reads the Concierge's `artifacts/` listing over IPC. */
	queryFn: (): Promise<ListConciergeArtifactsResult> =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:list-concierge-artifacts', usesDatabase: false },
			() => getEnsemblrApi().listConciergeArtifacts(),
		),
	queryKey: ensemblrQueryKeys.conciergeArtifacts(),
	staleTime: 5_000,
});

/**
 * Stops the Concierge's streaming turn.
 * @param request - Session id and an optional reason.
 * @returns Whether the stop landed.
 */
export async function stopConciergeSession(
	request: StopConciergeSessionRequest,
): Promise<StopConciergeSessionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:stop-concierge-session', usesDatabase: false },
		() => getEnsemblrApi().stopConciergeSession(request),
	);
}

/**
 * Clears the Concierge context, writing memory first unless told not to.
 * @param request - Why the clear is happening and whether to skip the memory pass.
 * @returns The replacement session, and whether the memory pass ran.
 */
export async function clearConciergeContext(
	request: ClearConciergeContextRequest,
): Promise<ClearConciergeContextResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:clear-concierge-context', usesDatabase: true },
		() => getEnsemblrApi().clearConciergeContext(request),
	);
}

/**
 * Subscribes to live Concierge transcript events.
 * @param listener - Called with each broadcast event.
 * @returns An unsubscribe function; a no-op when the bridge is absent.
 */
export function subscribeToConciergeEvents(
	listener: (broadcast: ConciergeEventBroadcastWire) => void,
): () => void {
	return (
		getEnsemblrApiOrNull()?.onConciergeSessionEvent(listener) ?? (() => {})
	);
}

/**
 * Tells the main process whether the Concierge panel is on screen, which is what
 * keeps a desktop notification from interrupting a user who is already reading
 * the answer. Fire-and-forget, like the active-chat report.
 * @param visible - True while the panel is open in any presentation.
 */
export function reportConciergeVisibility(visible: boolean): void {
	void getEnsemblrApiOrNull()?.reportConciergeVisibility({ visible });
}

/**
 * Subscribes to Concierge notification clicks, so the renderer can open the
 * panel the user clicked through to. Returns an unsubscribe fn.
 * @param listener - Runs once per click on a Concierge notification.
 * @returns The unsubscribe function.
 */
export function subscribeFocusConciergeRequests(
	listener: () => void,
): () => void {
	return (
		getEnsemblrApiOrNull()?.onFocusConciergeRequested(listener) ?? (() => {})
	);
}
