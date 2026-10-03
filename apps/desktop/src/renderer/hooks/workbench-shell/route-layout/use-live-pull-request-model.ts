import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
	pullRequestSnapshotQuery,
	reviewCommentsQuery,
	reviewTodosQuery,
	workspacePrObservationQuery,
} from '@/renderer/api/ensemblr-queries';
import { statesPresentationVerdict } from '@/renderer/lib/workbench/navigation-model';
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
 * Which source states the *status* is decided by when each observed GitHub,
 * never by which is loaded. The snapshot query only refreshes while a consumer
 * is mounted on the workspace, so its cache entry freezes the moment the user
 * navigates away while the background sweeper keeps the `fallback` presentation
 * moving — and React Query serves that frozen entry synchronously on the next
 * mount. Preferring it unconditionally is what walked a row back from
 * ready-to-merge to checks-running for the second a refetch took. So when the
 * fallback observed GitHub later, its verdict is grafted onto the live model
 * rather than replacing it: the status is the newer source's and the body —
 * title, checks, comments, branch sync — stays the live snapshot's, which is the
 * only source that has one. Before any snapshot lands there is no body to keep
 * and `fallback` is returned unchanged, by the same reference.
 *
 * The fallback's stamp is read here, from the cached navigation snapshot, rather
 * than off the model: the sweeper advances it on every write, and a stamp inside
 * the model would either rebuild every row on every poll or, held still to avoid
 * that, be compared against an observation the live query made in between. The
 * cached stamp is the newest there is, so it is lent to `fallback` only while
 * `fallback` still states the verdict the cache holds. A held render state can
 * hand over a model mapped from an older snapshot, and that one is known to be
 * superseded — it competes unstamped, which lets the live read win rather than
 * an older verdict wearing a newer stamp. A stamp that moves alone re-runs the
 * choice, not the build.
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
 * @param fallback - The navigation model's PR, whose verdict wins while it is the fresher observation.
 * @param workspaceCwd - Worktree path used by the snapshot query function.
 * @param workspaceId - Workspace id the PR queries and the fallback's stamp are keyed by.
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
	const observationQuery = useMemo(
		() => workspacePrObservationQuery(workspaceId),
		[workspaceId],
	);
	const { data: navigationObservation } = useQuery(observationQuery);
	const fallbackSyncedAt =
		navigationObservation &&
		statesPresentationVerdict(fallback, navigationObservation.presentation)
			? navigationObservation.syncedAt
			: undefined;

	// biome-ignore lint/correctness/useExhaustiveDependencies: the model builder translates through the i18n singleton, so the language is a real input Biome cannot see.
	const live = useMemo(
		() =>
			prSnapshotData
				? buildPullRequestShellModel({
						changeSummary,
						localComments: reviewCommentsData?.comments ?? [],
						snapshot: prSnapshotData.snapshot,
						...(prSnapshotData.error
							? { syncFailure: prSnapshotData.error }
							: {}),
						todos: reviewTodosData?.todos ?? [],
					})
				: null,
		[
			changeSummary,
			i18n.language,
			prSnapshotData,
			reviewCommentsData?.comments,
			reviewTodosData?.todos,
		],
	);
	const liveSyncedAt = prSnapshotData?.snapshot?.syncedAt;

	return useMemo(() => {
		if (!live) {
			return fallback;
		}
		return isFresherPrObservation(liveSyncedAt, fallbackSyncedAt)
			? live
			: withCachedPullRequestVerdict(live, fallback);
	}, [fallback, fallbackSyncedAt, live, liveSyncedAt]);
}
