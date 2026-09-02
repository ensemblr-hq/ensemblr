import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import type { ArchiveWorkspaceStatus } from '@/shared/ipc/contracts/workspace';

/** The one field the hop reads off an archive result: whether it happened. */
interface ArchiveStatusResult {
	status: ArchiveWorkspaceStatus;
}

/**
 * Runs one hop, reporting a rejected navigation rather than letting it escape.
 * A hop that fails must not take the archive down with it — the user asked for
 * the archive, and standing in the wrong place while it runs beats it silently
 * not running at all.
 * @param hop - The navigation to attempt
 * @returns True when the shell actually moved
 */
async function attemptHop(hop: () => Promise<void>): Promise<boolean> {
	try {
		await hop();
		return true;
	} catch (error) {
		console.error('Could not move the shell around an archive:', error);
		return false;
	}
}

/**
 * Runs the archive, putting the user back where they were when it did not
 * happen.
 * @param run - The archive to run
 * @param restore - Returns the shell to the route the hop took it from
 * @returns Whatever the archive reported
 */
async function runAndRestoreUnlessArchived<TResult extends ArchiveStatusResult>(
	run: () => Promise<TResult>,
	restore: () => Promise<boolean>,
): Promise<TResult> {
	let result: TResult;
	try {
		result = await run();
	} catch (error) {
		await restore();
		throw error;
	}

	if (result.status !== 'success') {
		await restore();
	}
	return result;
}

/**
 * Runs a workspace archive with the user standing somewhere else.
 *
 * Archiving tears the worktree down while they are still looking at it —
 * terminals stopped, agents killed — so the shell leaves first and they watch
 * the row go from a sibling workspace rather than watch their own come apart.
 * The index loader refuses an archiving workspace, so the hop lands past it.
 *
 * An archive that did not happen puts them back. Main vetoes a run *before* it
 * tears anything down — see the `pre-archive-workspace` hook in
 * `src/main/repository/archive-workspace.ts`, which returns `aborted` while the
 * worktree is still whole — so a user left in a sibling with only a toast to
 * explain it would have lost their place for nothing.
 * @param options - Active workspace identity, which decides whether a hop is needed at all
 * @returns A callback running one archive, hopping out and back around it
 */
export function useArchiveWorkspaceHop({
	activeWorkspaceId,
}: {
	activeWorkspaceId: string | null;
}): <TResult extends ArchiveStatusResult>(
	workspaceId: string,
	run: () => Promise<TResult>,
) => Promise<TResult> {
	const navigate = useNavigate();
	const router = useRouter();

	return useCallback(
		async <TResult extends ArchiveStatusResult>(
			workspaceId: string,
			run: () => Promise<TResult>,
		): Promise<TResult> => {
			if (activeWorkspaceId !== workspaceId) {
				return run();
			}

			const returnHref = router.state.location.href;
			const left = await attemptHop(() => navigate({ replace: true, to: '/' }));
			if (!left) {
				return run();
			}

			return runAndRestoreUnlessArchived(run, () =>
				attemptHop(() => navigate({ href: returnHref, replace: true })),
			);
		},
		[activeWorkspaceId, navigate, router],
	);
}
