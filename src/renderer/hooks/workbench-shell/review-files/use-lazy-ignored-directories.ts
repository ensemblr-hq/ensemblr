import { useQueries } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { workspaceDirectoryQuery } from '@/renderer/api/ensemblr-queries';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';
import type { ReadWorkspaceDirectoryResult } from '@/shared/ipc/contracts/workspace-files';

/**
 * Flattens every opened directory's children into one file list. Hoisted to
 * module scope so its reference is stable: `combine` re-runs when its own
 * reference changes, and its output is structurally shared, so a stable function
 * is what keeps the merged list referentially stable across renders and stops
 * the file tree rebuilding on every one.
 * @param results - One query result per opened directory.
 * @returns The children every opened directory reported, in query order.
 */
function combineDirectoryEntries(
	results: { data?: ReadWorkspaceDirectoryResult }[],
): WorkspaceFileSummary[] {
	return results.flatMap((result) =>
		(result.data?.entries ?? []).map((entry) => ({
			id: `wsfile:${entry.path}`,
			isIgnored: entry.isIgnored,
			kind: entry.kind,
			name: entry.name,
			path: entry.path,
		})),
	);
}

/**
 * Children of ignored directories the main process left collapsed (e.g.
 * `node_modules`), fetched one level per expand and merged into the flat file
 * list so the tree can browse any folder regardless of size.
 *
 * Each opened directory is its own query rather than a one-shot snapshot, so the
 * fs watcher's invalidation refreshes them alongside the file list and a child
 * that is deleted or moved away leaves the tree with everything else. The
 * watcher deliberately ignores `node_modules`, so a subtree there still refreshes
 * only on the coarse poll — every other ignored folder is live.
 * @param files - The workspace's enumerated files from the query
 * @param workspaceCwd - Absolute workspace path the directory read resolves against
 * @returns The merged file list and the loader an expand calls
 */
export function useLazyIgnoredDirectories({
	files,
	workspaceCwd,
}: {
	files: WorkspaceFileSummary[];
	workspaceCwd: string;
}) {
	const [openedDirectories, setOpenedDirectories] = useState<string[]>([]);

	const lazyChildren = useQueries({
		combine: combineDirectoryEntries,
		queries: openedDirectories.map((directoryPath) =>
			workspaceDirectoryQuery(workspaceCwd, directoryPath),
		),
	});

	const allFiles = useMemo(() => {
		if (lazyChildren.length === 0) {
			return files;
		}
		// Drop any lazily-fetched child already present in the base list, and any
		// path two opened directories both reported: a duplicate would otherwise
		// yield duplicate rows, since `buildFileTree` pushes files without
		// de-duping.
		const seen = new Set(files.map((entry) => entry.path));
		const extra = lazyChildren.filter((entry) => {
			if (seen.has(entry.path)) {
				return false;
			}
			seen.add(entry.path);
			return true;
		});
		return extra.length > 0 ? [...files, ...extra] : files;
	}, [files, lazyChildren]);

	const knownPaths = useMemo(
		() => new Set(allFiles.map((entry) => entry.path)),
		[allFiles],
	);

	// A directory that left the tree — deleted, or moved to a new path — must
	// stop being queried, or it is re-fetched forever and answers `not-directory`
	// on every invalidation. Pruning against the merged list rather than the base
	// one is what keeps a nested expand alive: a folder inside an opened ignored
	// directory only ever exists in that directory's own children.
	useEffect(() => {
		setOpenedDirectories((current) => {
			const next = current.filter((directoryPath) =>
				knownPaths.has(directoryPath),
			);
			return next.length === current.length ? current : next;
		});
	}, [knownPaths]);

	const loadIgnoredDirectory = useCallback(
		(directoryPath: string) => {
			if (!workspaceCwd) {
				return;
			}
			setOpenedDirectories((current) =>
				current.includes(directoryPath) ? current : [...current, directoryPath],
			);
		},
		[workspaceCwd],
	);

	return { allFiles, loadIgnoredDirectory };
}
