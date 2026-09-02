import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import type {
	ArchiveWorkspaceStatus,
	DeleteWorkspaceStatus,
} from '@/shared/ipc/contracts/workspace';

/** The one field the hop reads off a teardown result: whether it happened. */
interface TeardownStatusResult {
	status: ArchiveWorkspaceStatus | DeleteWorkspaceStatus;
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
		console.error('Could not move the shell around a teardown:', error);
		return false;
	}
}

/**
 * Runs the teardown, putting the user back where they were when it did not
 * happen.
 * @param run - The teardown to run
 * @param restore - Returns the shell to the route the hop took it from, reporting false when it declined to
 * @returns Whatever the teardown reported
 */
async function runAndRestoreUnlessTornDown<
	TResult extends TeardownStatusResult,
>(
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
 * Runs a workspace archive or delete with the user standing somewhere else.
 *
 * Either one tears the worktree down while they are still looking at it —
 * terminals stopped, agents killed — so the shell leaves first and they watch
 * the row go from a sibling workspace rather than watch their own come apart.
 * The index loader refuses a workspace under a teardown, so the hop lands past
 * it.
 *
 * A teardown that did not happen puts them back. Main vetoes an archive *before*
 * it tears anything down — see the `pre-archive-workspace` hook in
 * `src/main/repository/archive-workspace.ts`, which returns `aborted` while the
 * worktree is still whole — so a user left in a sibling with only a toast to
 * explain it would have lost their place for nothing. A delete that reports
 * `failure` reaches the same restore for the same reason.
 * @param options - Active workspace identity, which decides whether a hop is needed at all
 * @returns A callback running one teardown, hopping out and back around it
 */
export function useWorkspaceTeardownHop({
	activeWorkspaceId,
}: {
	activeWorkspaceId: string | null;
}): <TResult extends TeardownStatusResult>(
	workspaceId: string,
	run: () => Promise<TResult>,
) => Promise<TResult> {
	const navigate = useNavigate();
	const router = useRouter();

	return useCallback(
		async <TResult extends TeardownStatusResult>(
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

			// Where the hop actually left them, which is rarely `/`: the index loader
			// redirects on past a workspace under teardown into a sibling. Restoring
			// is only theirs to want while they are still standing there — a teardown
			// can fail long after the hop, and by then they may have opened a
			// workspace themselves, which is the one thing a restore must not undo.
			const hopLandedHref = router.state.location.href;

			return runAndRestoreUnlessTornDown(run, () => {
				if (router.state.location.href !== hopLandedHref) {
					return Promise.resolve(false);
				}
				return attemptHop(() => navigate({ href: returnHref, replace: true }));
			});
		},
		[activeWorkspaceId, navigate, router],
	);
}
