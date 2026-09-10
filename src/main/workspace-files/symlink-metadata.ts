import { lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceFileEntryWire } from '../../shared/ipc/contracts/workspace-files';

/**
 * Adds icon-only target metadata without changing a link's leaf kind or reading
 * its contents. Missing/unreadable entries keep their listing; dangling,
 * inaccessible and cyclic targets keep a link marker with an unknown kind.
 * @param workspaceCwd - Workspace root the listed paths are relative to.
 * @param entries - Bounded listing of files and directories to annotate.
 * @returns Entries with target kinds attached to symbolic links only.
 */
export function annotateSymlinkTargets(
	workspaceCwd: string,
	entries: readonly WorkspaceFileEntryWire[],
): Promise<WorkspaceFileEntryWire[]> {
	return Promise.all(
		entries.map(async (entry) => {
			if (entry.kind === 'directory') {
				return entry;
			}
			const absolutePath = path.join(workspaceCwd, entry.path);
			const linkStat = await lstat(absolutePath).catch(() => null);
			if (!linkStat?.isSymbolicLink()) {
				return entry;
			}
			const targetStat = await stat(absolutePath).catch(() => null);
			return {
				...entry,
				symlinkTargetKind: targetStat
					? targetStat.isDirectory()
						? ('directory' as const)
						: ('file' as const)
					: ('unknown' as const),
			};
		}),
	);
}
