import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom, useSetAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
	clearConciergeContext,
	conciergeEventsQuery,
	ensemblrQueryKeys,
	openConciergeSession,
	stopConciergeSession,
	submitConciergePrompt,
	subscribeToConciergeEvents,
} from '@/renderer/api/ensemblr';
import { mergeConciergeEvents } from '@/renderer/lib/concierge';
import {
	type ConciergeSessionIdentity,
	conciergeClearBannerDismissedAtom,
	conciergeSessionAtom,
} from '@/renderer/state/concierge';
import type { AgentProviderId } from '@/shared/agent-provider';
import type {
	ClearConciergeContextRequest,
	ConciergeSessionEventWire,
	ConciergeSessionSnapshotWire,
} from '@/shared/ipc/contracts/concierge';

/** What the Concierge panel needs to render and drive one conversation. */
export interface ConciergeSessionModel {
	clear: (request: ClearConciergeContextRequest) => Promise<void>;
	error: string | null;
	events: readonly ConciergeSessionEventWire[];
	isClearing: boolean;
	isOpening: boolean;
	isStreaming: boolean;
	sessionId: string | null;
	/** The Concierge home the open session runs in, or null before one is open. */
	cwd: string | null;
	/** Runtime the open session is on, or null before one is open. */
	sessionProvider: AgentProviderId | null;
	stop: () => Promise<void>;
	submit: (
		prompt: string,
		selection?: {
			model?: string | null;
			provider?: AgentProviderId | null;
			thinkingLevel?: string | null;
		},
	) => Promise<void>;
}

/** Stands in for the transcript before one is read, at a stable identity. */
const NO_EVENTS: readonly ConciergeSessionEventWire[] = [];

/**
 * Derives whether the Concierge is mid-turn from its own transcript.
 *
 * The status events are the only signal available — unlike a workspace chat
 * there is no session list to read a row's status from — so the last status
 * event wins, and an empty transcript reads as idle.
 * @param events - The transcript so far.
 * @returns True while the runtime reports a streaming turn.
 */
function isStreamingFrom(
	events: readonly ConciergeSessionEventWire[],
): boolean {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const payload = events[index]?.payload;
		if (payload?.kind === 'status') {
			return payload.status === 'streaming';
		}
	}
	return false;
}

/**
 * Reduces an opened session to the three fields the panel drives it by.
 * @param session - The snapshot the main process returned, if any.
 * @returns The identity to hold, or null when nothing opened.
 */
function identityOf(
	session: ConciergeSessionSnapshotWire | undefined,
): ConciergeSessionIdentity | null {
	return session
		? { cwd: session.cwd, id: session.id, provider: session.provider }
		: null;
}

/**
 * Reads a thrown value back as the sentence to show on the panel's error line.
 * @param cause - Whatever was thrown or rejected with.
 * @param fallback - What to say when the cause carries no message of its own.
 * @returns The message to surface.
 */
function failureMessage(cause: unknown, fallback: string): string {
	if (cause instanceof Error && cause.message) {
		return cause.message;
	}
	return typeof cause === 'string' && cause.length > 0 ? cause : fallback;
}

/**
 * Opens the Concierge session, keeps its transcript current, and exposes the
 * three things the panel can do to it: submit, stop, and clear.
 *
 * The session is opened once per identity rather than per render, and live
 * events are merged into the query cache rather than triggering a refetch — the
 * transcript only ever grows, so re-reading it would spend a database round trip
 * to learn what the broadcast already said.
 * @param enabled - Whether the panel is on screen; false leaves the session shut.
 * @returns The Concierge session model.
 */
export function useConciergeSession(enabled: boolean): ConciergeSessionModel {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [session, setSession] = useAtom(conciergeSessionAtom);
	const setBannerDismissed = useSetAtom(conciergeClearBannerDismissedAtom);
	const [error, setError] = useState<string | null>(null);
	const [isOpening, setIsOpening] = useState(false);
	const sessionId = session?.id ?? null;
	const unknownFailure = t(
		'workbench:concierge.session.unknown-failure',
		'Something went wrong in the Concierge.',
	);

	useEffect(() => {
		if (!enabled || session) {
			return;
		}
		let cancelled = false;
		setIsOpening(true);
		openConciergeSession()
			.then((result) => {
				if (cancelled) {
					return;
				}
				setError(result.error ?? null);
				setSession(identityOf(result.session));
			})
			.catch((cause: unknown) => {
				if (cancelled) {
					return;
				}
				setError(failureMessage(cause, unknownFailure));
			})
			.finally(() => {
				if (!cancelled) {
					setIsOpening(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [enabled, session, setSession, unknownFailure]);

	const eventsQuery = useQuery(conciergeEventsQuery(sessionId));
	const events = eventsQuery.data?.events ?? NO_EVENTS;

	useEffect(() => {
		if (!sessionId) {
			return;
		}
		return subscribeToConciergeEvents((broadcast) => {
			if (broadcast.sessionId !== sessionId) {
				return;
			}
			queryClient.setQueryData(
				ensemblrQueryKeys.conciergeEvents(sessionId),
				(
					current: { events: readonly ConciergeSessionEventWire[] } | undefined,
				) => ({
					events: mergeConciergeEvents(current?.events ?? NO_EVENTS, [
						broadcast.event,
					]),
				}),
			);
		});
	}, [queryClient, sessionId]);

	const adoptSession = useCallback(
		(next: ConciergeSessionIdentity | null, replaced: string | null) => {
			setSession(next);
			if (replaced && replaced !== next?.id) {
				// The old transcript never goes stale — `staleTime` is infinite and
				// nothing refetches it — so left in place it stays resident for the
				// rest of the run.
				queryClient.removeQueries({
					queryKey: ensemblrQueryKeys.conciergeEvents(replaced),
				});
			}
		},
		[queryClient, setSession],
	);

	const submitMutation = useMutation({
		/**
		 * Sends one prompt to the open Concierge session, carrying the composer's
		 * current model and thinking level so a picker change takes effect on the
		 * next turn rather than waiting for the session to be replaced.
		 */
		mutationFn: async (input: {
			model?: string | null;
			prompt: string;
			provider?: AgentProviderId | null;
			thinkingLevel?: string | null;
		}) => {
			if (!session) {
				throw new Error(
					t(
						'workbench:concierge.session.not-open',
						'The Concierge session is not open.',
					),
				);
			}
			// A model belongs to exactly one runtime and a runtime cannot switch
			// mid-session, so picking the other one's model reopens the Concierge
			// on it rather than sending a turn that would be refused. No memory
			// pass: the user changed a setting, they did not ask to forget.
			let targetSessionId = session.id;
			if (input.provider && input.provider !== session.provider) {
				const reopened = await openConciergeSession({ fresh: true });
				if (reopened.error || !reopened.session) {
					throw new Error(
						reopened.error ??
							t(
								'workbench:concierge.session.reopen-failed',
								'The Concierge session could not be reopened.',
							),
					);
				}
				targetSessionId = reopened.session.id;
				adoptSession(identityOf(reopened.session), session.id);
			}

			const result = await submitConciergePrompt({
				model: input.model ?? null,
				prompt: input.prompt,
				sessionId: targetSessionId,
				thinkingLevel: input.thinkingLevel ?? null,
			});
			if (result.error) {
				throw new Error(result.error);
			}
		},
		/**
		 * A turn is the only thing that moves context usage, and a submit that had
		 * to reopen the session left the gauge reading the one it replaced.
		 */
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.conciergeContextPressure(),
			}),
	});

	const clearMutation = useMutation({
		/** Clears the context and swaps in the replacement session. */
		mutationFn: async (request: ClearConciergeContextRequest) => {
			const result = await clearConciergeContext(request);
			if (result.error) {
				throw new Error(result.error);
			}
			setBannerDismissed(false);
			adoptSession(identityOf(result.session), sessionId);
		},
		/**
		 * Awaited before the mutation settles, so the banner is gone by the time the
		 * button reads as idle again; left to the 15-second poll it would sit there
		 * for another interval insisting the context it just cleared is still full.
		 */
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.conciergeContextPressure(),
			}),
	});

	const submit = useCallback(
		async (
			prompt: string,
			selection?: {
				model?: string | null;
				provider?: AgentProviderId | null;
				thinkingLevel?: string | null;
			},
		) => {
			setError(null);
			try {
				await submitMutation.mutateAsync({ ...selection, prompt });
			} catch (cause) {
				setError(failureMessage(cause, unknownFailure));
			}
		},
		[submitMutation.mutateAsync, unknownFailure],
	);

	const clear = useCallback(
		async (request: ClearConciergeContextRequest) => {
			setError(null);
			try {
				await clearMutation.mutateAsync(request);
			} catch (cause) {
				setError(failureMessage(cause, unknownFailure));
			}
		},
		[clearMutation.mutateAsync, unknownFailure],
	);

	const stop = useCallback(async () => {
		if (!sessionId) {
			return;
		}
		try {
			const result = await stopConciergeSession({
				reason: 'user-stopped',
				sessionId,
			});
			if (result.error) {
				throw new Error(result.error);
			}
		} catch (cause) {
			setError(failureMessage(cause, unknownFailure));
		}
	}, [sessionId, unknownFailure]);

	return {
		clear,
		cwd: session?.cwd ?? null,
		error,
		events,
		isClearing: clearMutation.isPending,
		isOpening,
		isStreaming: isStreamingFrom(events),
		sessionId,
		sessionProvider: session?.provider ?? null,
		stop,
		submit,
	};
}
