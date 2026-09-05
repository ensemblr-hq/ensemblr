import { atom, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * What the workspace route knows that main does not, for the one workspace it
 * currently has open.
 *
 * `startReview` composes the review prompt in the renderer wherever it can, so
 * an agent's review is the user's review — their per-repository review
 * instructions and their pinned review model included, neither of which leaves
 * `localStorage`. Reaching them needs the live workspace model, and that is
 * assembled by the route rather than fetched, so the route publishes it here and
 * the app-root responder reads it.
 */
export interface LiveReviewContext {
	workspaceId: string;
	repositoryId: string;
	repositoryPath: string;
	workspace: WorkspaceShellModel;
}

/**
 * The open workspace route's review context, or null when no workspace route is
 * mounted. Single-valued rather than keyed by workspace id because exactly one
 * workspace route is mounted at a time; a request naming any other workspace
 * falls back to main composing the brief itself.
 */
export const liveReviewContextAtom = atom<LiveReviewContext | null>(null);

/**
 * Publishes the mounted workspace route's review context for the app-root
 * responder, and clears it on unmount so a stale model cannot answer for a
 * workspace the user has navigated away from.
 *
 * The clear is a second, unmount-only effect rather than the first one's
 * cleanup. The route republishes on every git-status refetch, and a cleanup that
 * ran between the two writes would leave the atom null for a tick — long enough
 * for a request landing in it to be declined and answered by main's weaker
 * fallback.
 * @param context - The route's current review context.
 */
export function usePublishLiveReviewContext(context: LiveReviewContext): void {
	const publish = useSetAtom(liveReviewContextAtom);

	useEffect(() => {
		publish(context);
	}, [context, publish]);

	useEffect(
		() => () => {
			publish(null);
		},
		[publish],
	);
}
