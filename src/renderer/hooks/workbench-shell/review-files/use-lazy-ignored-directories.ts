import { useCallback, useMemo, useRef, useState } from 'react';

import { readWorkspaceDirectory } from '@/renderer/api/ensemblr-queries';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

/**
 * Children of ignored directories the main process left collapsed (e.g.
 * `node_modules`), fetched one level per expand and merged into the flat file
 * list so the tree can browse any folder regardless of size.
 *
 * Known limitation: these lazily-fetched entries are local state, not part of
 * the `files` query, so they are NOT live-refreshed by the fs watcher or the
 * poll (which the watcher deliberately ignores for `node_modules` anyway). An
 * ignored folder expanded here shows a point-in-time snapshot until the
 * workspace remounts. Acceptable: ignored dirs rarely need live tracking, and
 * the loaded-directory set prevents refetch churn.
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
	const [lazyChildren, setLazyChildren] = useState<WorkspaceFileSummary[]>([]);
	const loadedDirsRef = useRef<Set<string>>(new Set());

	const allFiles = useMemo(() => {
		if (lazyChildren.length === 0) {
			return files;
		}
		// Drop any lazily-fetched child already present in the base list: a path
		// in both would otherwise yield duplicate rows, since `buildFileTree`
		// pushes files without de-duping.
		const basePaths = new Set(files.map((entry) => entry.path));
		const extra = lazyChildren.filter((entry) => !basePaths.has(entry.path));
		return extra.length > 0 ? [...files, ...extra] : files;
	}, [files, lazyChildren]);

	const loadIgnoredDirectory = useCallback(
		async (directoryPath: string) => {
			if (!workspaceCwd || loadedDirsRef.current.has(directoryPath)) {
				return;
			}
			loadedDirsRef.current.add(directoryPath);
			const result = await readWorkspaceDirectory({
				path: directoryPath,
				workspaceCwd,
			});
			if (result.error) {
				// Let a later expand retry.
				loadedDirsRef.current.delete(directoryPath);
				return;
			}
			setLazyChildren((previous) => {
				const seen = new Set(previous.map((entry) => entry.path));
				const additions = result.entries.flatMap((entry) =>
					seen.has(entry.path)
						? []
						: [
								{
									id: `wsfile:${entry.path}`,
									isIgnored: entry.isIgnored,
									kind: entry.kind,
									name: entry.name,
									path: entry.path,
								},
							],
				);
				return additions.length > 0 ? [...previous, ...additions] : previous;
			});
		},
		[workspaceCwd],
	);

	return { allFiles, loadIgnoredDirectory };
}
