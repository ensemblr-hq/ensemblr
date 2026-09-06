import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
	pullRequestSnapshotQuery,
	reviewCommentsQuery,
	reviewTodosQuery,
} from '@/renderer/api/ensemblr-queries';
import {
	buildPullRequestShellModel,
	withCachedPullRequestVerdict,
} from '@/renderer/lib/workbench/pull-request-model';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import { isFresherPrObservation } from '@/shared/github-pr-presentation';

/** Inputs for {@link useLivePullRequestModel}. */
interface UseLivePullRequestModelInput {
	changeSummary: WorkspaceShellModel['changeSummary'];
	enabled?: boolean;
	fallback: WorkspaceShellModel['pullRequest'];
	workspaceCwd: string | null;
	workspaceId: string;
}

/**
 * Builds a workspace's live PR shell model from the shared gh-snapshot query
 * cache, so every consumer keyed by the same workspace id reads one source and
 * re-renders in the same notify batch. The right-sidebar header and the active
 * sidebar row both use this: it is what keeps the header state and the workspace
 * icon in lockstep when a PR flips to ready-to-merge, instead of one lagging a
 * slower navigation poll.
 *
 * Which source states the *status* is decided by `syncedAt`, never by which is
 * loaded. The snapshot query only refreshes while a consumer is mounted on the
 * workspace, so its cache entry freezes the moment the user navigates away while
 * the background sweeper keeps the `fallback` presentation moving — and React
 * Query serves that frozen entry synchronously on the next mount. Preferring it
 * unconditionally is what walked a row back from ready-to-merge to
 * checks-running for the second a refetch took. So when the fallback observed
 * GitHub later, its verdict is grafted onto the live model rather than replacing
 * it: the status is the newer source's and the body — title, checks, comments,
 * branch sync — stays the live snapshot's, which is the only source that has one.
 * Before any snapshot lands there is no body to keep and `fallback` is returned
 * unchanged, by the same reference.
 *
 * `enabled` gates the queries, not the choice: an inactive row keeps rendering a
 * live snapshot it already holds for as long as that snapshot is the fresher of
 * the two, rather than regressing to the navigation poll's copy on blur.
 *
 * The model it builds carries already-translated labels, so the active language
 * is one of the memo's inputs and a language switch rebuilds it.
 *
 * @param changeSummary - Branch change counts folded into the PR git-status row.
 * @param enabled - Whether to fetch and poll the live queries; a false value still reads what they have cached.
 * @param fallback - PR model whose verdict wins while it is the fresher observation.
 * @param workspaceCwd - Worktree path used by the snapshot query function.
 * @param workspaceId - Workspace id the PR queries are keyed by.
 * @returns The PR model, carrying whichever source saw GitHub last.
 */
export function useLivePullRequestModel({
	changeSummary,
	enabled = true,
	fallback,
	workspaceCwd,
	workspaceId,
}: UseLivePullRequestModelInput): WorkspaceShellModel['pullRequest'] {
	const { i18n } = useTranslation();
	const { data: prSnapshotData } = useQuery({
		...pullRequestSnapshotQuery({ workspaceCwd, workspaceId }),
		enabled: enabled && !!workspaceCwd && !!workspaceId,
	});
	const { data: reviewCommentsData } = useQuery({
		...reviewCommentsQuery(workspaceId),
		enabled: enabled && !!workspaceId,
	});
	const { data: reviewTodosData } = useQuery({
		...reviewTodosQuery(workspaceId),
		enabled: enabled && !!workspaceId,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: the model builder translates through the i18n singleton, so the language is a real input Biome cannot see.
	return useMemo(() => {
		if (!prSnapshotData) {
			return fallback;
		}
		const live = buildPullRequestShellModel({
			changeSummary,
			localComments: reviewCommentsData?.comments ?? [],
			snapshot: prSnapshotData.snapshot,
			...(prSnapshotData.error ? { syncFailure: prSnapshotData.error } : {}),
			todos: reviewTodosData?.todos ?? [],
		});
		return isFresherPrObservation(
			prSnapshotData.snapshot?.syncedAt,
			fallback.syncedAt,
		)
			? live
			: withCachedPullRequestVerdict(live, fallback);
	}, [
		changeSummary,
		fallback,
		i18n.language,
		prSnapshotData,
		reviewCommentsData?.comments,
		reviewTodosData?.todos,
	]);
}
