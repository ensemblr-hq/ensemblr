import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import {
	ensemblrQueryKeys,
	getEnsemblrApiOrNull,
} from '@/renderer/api/ensemblr/query-keys';

/**
 * How often a run of file events may re-enumerate the expanded ignored
 * directories. Matches the `staleTime` on `workspaceDirectoryQuery`, which is
 * the cadence those rows are already allowed to be behind by.
 */
const DIRECTORY_REFRESH_INTERVAL_MS = 5_000;

/**
 * A refresh of the workspace's expanded ignored directories, rate-limited to one
 * enumeration per {@link DIRECTORY_REFRESH_INTERVAL_MS} with a trailing call so
 * the last state of a burst is never the one left on screen. The first request
 * after mount is always immediate — hence the `-Infinity` seed rather than `0`,
 * which would make the leading edge depend on the epoch the clock starts at.
 *
 * The file list is invalidated on every broadcast because it is what the tree
 * draws from, but each expanded ignored folder is a query of its own, so an
 * unthrottled broadcast costs one IPC round-trip per folder the session has ever
 * opened — and `invalidateQueries` refetches an active query whatever its
 * `staleTime`. The watcher clamps sustained churn to a broadcast per second, so
 * that fan-out would otherwise be paid every second for contents that are
 * ignored by definition.
 * @param workspaceCwd - Absolute workspace root whose directories to refresh
 * @returns A function requesting a refresh, coalescing calls inside the window
 */
function useThrottledDirectoryRefresh(workspaceCwd: string | null): () => void {
	const queryClient = useQueryClient();
	const lastRefreshAtRef = useRef(Number.NEGATIVE_INFINITY);
	const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (trailingTimerRef.current) {
				clearTimeout(trailingTimerRef.current);
				trailingTimerRef.current = null;
			}
		},
		[],
	);

	return useCallback(() => {
		if (!workspaceCwd || trailingTimerRef.current) {
			return;
		}
		const elapsed = Date.now() - lastRefreshAtRef.current;
		trailingTimerRef.current = setTimeout(
			() => {
				trailingTimerRef.current = null;
				lastRefreshAtRef.current = Date.now();
				void queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.workspaceDirectories(workspaceCwd),
				});
			},
			Math.max(0, DIRECTORY_REFRESH_INTERVAL_MS - elapsed),
		);
	}, [queryClient, workspaceCwd]);
}

/**
 * Keeps the workspace file list fresh in near-real-time: asks the main process
 * to watch `workspaceCwd` and invalidates the cached file list whenever a
 * change is broadcast, along with the lazily enumerated directories the files
 * tree expanded, so a child deleted or moved out of an ignored folder leaves the
 * tree with everything else. The polling on `workspaceFilesQuery` stays as a
 * coarse fallback for platforms or ignored paths the watcher cannot cover. The
 * same broadcast also refreshes the workspace-scoped settings snapshot, so a
 * newly authored `.ensemblr/settings.toml` updates the Setup and Run dock
 * panels.
 *
 * The directory leg is throttled rather than immediate — see
 * {@link useThrottledDirectoryRefresh} — because it fans out per expanded folder
 * where the other two are a single query each.
 *
 * No-ops when no workspace is active or the preload bridge is unavailable
 * (e.g. tests). Re-subscribes when the active workspace changes.
 * @param options - Active repository and workspace identifiers for cache refresh.
 */
export function useWorkspaceFilesWatch({
	repositoryId,
	workspaceCwd,
}: {
	repositoryId: string | null;
	workspaceCwd: string | null;
}): void {
	const queryClient = useQueryClient();
	const refreshExpandedDirectories = useThrottledDirectoryRefresh(workspaceCwd);

	useEffect(() => {
		const api = getEnsemblrApiOrNull();

		if (!api || !workspaceCwd) {
			return;
		}

		void api.watchWorkspaceFiles({ workspaceCwd });
		const unsubscribe = api.onWorkspaceFilesChanged((event) => {
			if (event.workspaceCwd !== workspaceCwd) {
				return;
			}

			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.workspaceFiles(workspaceCwd),
			});

			refreshExpandedDirectories();

			if (repositoryId) {
				void queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.settingsResolution(
						repositoryId,
						workspaceCwd,
					),
				});
			}
		});

		return () => {
			unsubscribe();
			void api.unwatchWorkspaceFiles({ workspaceCwd });
		};
	}, [queryClient, refreshExpandedDirectories, repositoryId, workspaceCwd]);
}
