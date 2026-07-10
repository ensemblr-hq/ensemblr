import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
	refreshPullRequestSnapshot,
	subscribePiSessionEvents,
} from '@/renderer/api/ensemblr-queries';

/**
 * Forces a cache-bypassing PR-snapshot refresh the instant the workspace's agent
 * finishes a turn (a `status` event transitioning streaming/starting → idle).
 *
 * Agents create PRs, push, and merge from their own shell, which the app cannot
 * see; without this the Checks panel and PR header wait for the next poll (and
 * that poll can still hit the main process's snapshot TTL). The turn-end signal
 * is the cheapest reliable hook — a `gh pr create` almost always lands just
 * before the agent goes idle. The background poll remains the fallback.
 */
export function usePullRequestAutoRefresh({
	workspaceCwd,
	workspaceId,
}: {
	workspaceCwd: string | null;
	workspaceId: string;
}): void {
	const queryClient = useQueryClient();
	// Coalesces overlapping turn-end refreshes (e.g. two sessions finishing at
	// once) so we never fire a second forced `gh` fetch while one is in flight.
	const inFlightRef = useRef(false);

	useEffect(() => {
		if (!workspaceCwd || !workspaceId) {
			return;
		}
		return subscribePiSessionEvents((broadcast) => {
			if (broadcast.workspaceId !== workspaceId) {
				return;
			}
			const payload = broadcast.event.payload;
			const finishedTurn =
				payload?.kind === 'status' &&
				payload.status === 'idle' &&
				(payload.previous === 'starting' || payload.previous === 'streaming');
			if (!finishedTurn || inFlightRef.current) {
				return;
			}
			inFlightRef.current = true;
			void refreshPullRequestSnapshot({
				queryClient,
				workspaceCwd,
				workspaceId,
			})
				.catch((cause) => {
					// Best-effort background refresh; the 30s poll is the fallback.
					console.error('Failed to auto-refresh PR snapshot:', cause);
				})
				.finally(() => {
					inFlightRef.current = false;
				});
		});
	}, [queryClient, workspaceCwd, workspaceId]);
}
