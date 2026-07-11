import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
	refreshPullRequestSnapshot,
	refreshPullRequestSnapshotUntilPresent,
	subscribePiSessionEvents,
} from '@/renderer/api/ensemblr-queries';

import {
	classifyPullRequestRefreshAction,
	type PullRequestRefreshAction,
} from './detect-pull-request-creation';

/** A refresh action that should trigger a gh-backed PR snapshot fetch. */
type RefreshAction = Extract<PullRequestRefreshAction, { kind: 'refresh' }>;

/** Mutable in-flight flags for plain and created-PR refresh lanes. */
interface RefreshInFlightRefs {
	created: { current: boolean };
	plain: { current: boolean };
}

/**
 * Starts a PR snapshot refresh when the matching refresh lane is available.
 * @param action - The refresh action classified from a Pi session event.
 * @param inFlight - Mutable in-flight flags for coalescing duplicate refreshes.
 * @param queryClient - Query cache to update with the fetched snapshot.
 * @param signal - Abort signal tied to the hook lifetime.
 * @param workspaceCwd - Workspace directory for gh commands.
 * @param workspaceId - Workspace identifier backing the query key.
 * @returns True when a refresh started, otherwise false.
 */
function startRefreshAction({
	action,
	inFlight,
	queryClient,
	signal,
	workspaceCwd,
	workspaceId,
}: {
	action: RefreshAction;
	inFlight: RefreshInFlightRefs;
	queryClient: QueryClient;
	signal: AbortSignal;
	workspaceCwd: string;
	workspaceId: string;
}): boolean {
	const hasRefreshInFlight = inFlight.plain.current || inFlight.created.current;
	if (!action.createdPr && hasRefreshInFlight) {
		return false;
	}
	if (action.createdPr && inFlight.created.current) {
		return false;
	}
	const activeFlag = action.createdPr ? inFlight.created : inFlight.plain;
	activeFlag.current = true;
	const refresh = action.createdPr
		? refreshPullRequestSnapshotUntilPresent({
				queryClient,
				signal,
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
			activeFlag.current = false;
		});
	return true;
}

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
 * When the agent emits the created PR URL, the retry starts immediately; when
 * only the `gh pr create` command was observed, the finished turn runs the same
 * retry. Both paths absorb GitHub's read-after-write race where `gh pr view`
 * momentarily reports no PR. Other turns keep the single cheap refresh so no-PR
 * editing turns do not spawn extra `gh` calls.
 */
export function usePullRequestAutoRefresh({
	workspaceCwd,
	workspaceId,
}: {
	workspaceCwd: string | null;
	workspaceId: string;
}): void {
	const queryClient = useQueryClient();
	// Coalesces overlapping plain turn-end refreshes while still allowing a
	// stronger created-PR retry to overtake a plain refresh already in flight.
	const plainRefreshInFlightRef = useRef(false);
	const createdRefreshInFlightRef = useRef(false);
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
			if (action.kind === 'none') {
				return;
			}
			const started = startRefreshAction({
				action,
				inFlight: {
					created: createdRefreshInFlightRef,
					plain: plainRefreshInFlightRef,
				},
				queryClient,
				signal: controller.signal,
				workspaceCwd,
				workspaceId,
			});
			if (action.createdPr || started) {
				prCreatedThisTurnRef.current = false;
			}
		});
		return () => {
			controller.abort();
			unsubscribe();
		};
	}, [queryClient, workspaceCwd, workspaceId]);
}
