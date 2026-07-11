import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
	refreshPullRequestSnapshot,
	refreshPullRequestSnapshotUntilPresent,
	subscribePiSessionEvents,
} from '@/renderer/api/ensemblr-queries';

import { classifyPullRequestRefreshAction } from './detect-pull-request-creation';

/**
 * Forces a cache-bypassing PR-snapshot refresh the instant the workspace's agent
 * finishes a turn (a `status` event transitioning streaming/starting → idle).
 *
 * Agents create PRs, push, and merge from their own shell, which the app cannot
 * see; without this the Checks panel and PR header wait for the next poll (and
 * that poll can still hit the main process's snapshot TTL). The turn-end signal
 * is the cheapest reliable hook — a `gh pr create` almost always lands just
 * before the agent goes idle. The background poll remains the fallback.
 *
 * When the finished turn actually created a PR (detected from its tool events),
 * the refresh retries until the PR surfaces, absorbing GitHub's read-after-write
 * race where `gh pr view` momentarily reports no PR. Other turns keep the single
 * cheap refresh so no-PR editing turns do not spawn extra `gh` calls.
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
	// Set when the current turn produced a `gh pr create` / PR-URL tool event;
	// gates the retry-until-present refresh and resets at each turn boundary.
	const prCreatedThisTurnRef = useRef(false);

	useEffect(() => {
		if (!workspaceCwd || !workspaceId) {
			return;
		}
		const controller = new AbortController();
		const unsubscribe = subscribePiSessionEvents((broadcast) => {
			if (broadcast.workspaceId !== workspaceId) {
				return;
			}
			const envelope = broadcast.event.payload;
			if (!envelope) {
				return;
			}
			const action = classifyPullRequestRefreshAction(
				envelope,
				prCreatedThisTurnRef.current,
			);
			if (action.kind === 'mark-created') {
				prCreatedThisTurnRef.current = true;
				return;
			}
			if (action.kind === 'reset') {
				prCreatedThisTurnRef.current = false;
				return;
			}
			if (action.kind === 'none' || inFlightRef.current) {
				return;
			}
			prCreatedThisTurnRef.current = false;
			inFlightRef.current = true;
			const refresh = action.createdPr
				? refreshPullRequestSnapshotUntilPresent({
						queryClient,
						signal: controller.signal,
						workspaceCwd,
						workspaceId,
					})
				: refreshPullRequestSnapshot({
						queryClient,
						workspaceCwd,
						workspaceId,
					});
			void refresh
				.catch((cause) => {
					// Best-effort background refresh; the 30s poll is the fallback.
					console.error('Failed to auto-refresh PR snapshot:', cause);
				})
				.finally(() => {
					inFlightRef.current = false;
				});
		});
		return () => {
			controller.abort();
			unsubscribe();
		};
	}, [queryClient, workspaceCwd, workspaceId]);
}
