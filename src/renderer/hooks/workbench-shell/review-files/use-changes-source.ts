import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { workspaceGitStatusQuery } from '@/renderer/api/ensemblr';
import { mapGitStatusToReviewFiles } from '@/renderer/lib/workbench/review-files';
import { changesSourceByWorkspaceAtom } from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { ChangesSource } from '@/renderer/types/workbench-shell';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

import { useLatestTurnScope } from './use-latest-turn-scope';

/**
 * Resolves the active change source to the git diff scope a query needs.
 * @param source - The change source the user selected for this workspace
 * @param baseRef - Base branch the workspace branched from, when known
 * @param latestTurn - Scope of the workspace's newest checkpointed turn, if any
 * @returns The scope to pass to the git status and diff queries
 */
function sourceToScope(
	source: ChangesSource,
	baseRef: string | null,
	latestTurn: WorkspaceGitDiffScope | null,
): WorkspaceGitDiffScope {
	if (source.kind === 'commit') {
		return { commitHash: source.hash, kind: 'commit' };
	}
	// No checkpoint means nothing to scope to — a workspace whose agent has not
	// run yet degrades to the working tree rather than showing an empty list.
	if (source.kind === 'latest-turn') {
		return latestTurn ?? { kind: 'working-tree' };
	}
	// "All changes" means the whole branch — but it can only diff against a base
	// when one is known; otherwise it degrades to the working-tree change set.
	if (source.kind === 'all' && baseRef) {
		return { baseRef, kind: 'branch' };
	}
	return { kind: 'working-tree' };
}

/**
 * Empty-state copy tailored to the active change source.
 * @param t - Translator bound to the active language
 * @param source - The change source currently being viewed
 * @param turnLookupFailed - Whether the turn source's checkpoint read failed
 * @returns The title and message the empty file list shows
 */
function emptyStateForSource(
	t: TFunction,
	source: ChangesSource,
	turnLookupFailed: boolean,
): {
	message: string;
	title: string;
} {
	if (source.kind === 'latest-turn' && turnLookupFailed) {
		return {
			message: t(
				'git:changes-source.empty.turn-lookup-failed.message',
				'This workspace’s turn history could not be read, so there is nothing to scope the list to.',
			),
			title: t(
				'git:changes-source.empty.turn-lookup-failed.title',
				'Could not find the latest turn',
			),
		};
	}
	if (source.kind === 'uncommitted') {
		return {
			message: t(
				'git:changes-source.empty.uncommitted.message',
				'Everything here is committed.',
			),
			title: t(
				'git:changes-source.empty.uncommitted.title',
				'No uncommitted changes yet',
			),
		};
	}
	if (source.kind === 'latest-turn') {
		return {
			message: t(
				'git:changes-source.empty.latest-turn.message',
				'The last agent turn left the files untouched.',
			),
			title: t(
				'git:changes-source.empty.latest-turn.title',
				'No changes in the latest turn',
			),
		};
	}
	if (source.kind === 'commit') {
		return {
			message: t(
				'git:changes-source.empty.commit.message',
				'{{shortHash}} touched no files.',
				{ shortHash: source.shortHash },
			),
			title: t(
				'git:changes-source.empty.commit.title',
				'No changes in this commit',
			),
		};
	}
	return {
		message: t(
			'git:changes-source.empty.branch.message',
			'Changes on this branch appear here.',
		),
		title: t('git:changes-source.empty.branch.title', 'No changes yet'),
	};
}

/**
 * Writes the Changes-tab source for one workspace.
 *
 * Exported on its own so the workspace shell can drive ⌥⌘U without mounting the
 * review panel the rest of {@link useChangesSource} serves: the selection lives
 * in a persisted atom keyed by workspace, so there is nothing to hand between
 * the two callers.
 * @param workspaceId - Workspace whose Changes source is being written
 * @returns A setter storing the source for that workspace
 */
export function useSetChangesSource(
	workspaceId: string,
): (next: ChangesSource) => void {
	const setSourceMap = useSetAtom(changesSourceByWorkspaceAtom);

	return useCallback(
		(next: ChangesSource) => {
			setSourceMap((current) => ({ ...current, [workspaceId]: next }));
		},
		[setSourceMap, workspaceId],
	);
}

/**
 * The Changes tab's source selection and the file set it resolves to. The tab
 * can show every branch change, only uncommitted edits, or a single commit —
 * picked per workspace and persisted.
 *
 * The working-tree scope reuses the live model's query (same key), so only the
 * branch and commit views issue an extra git read. Until the source query
 * resolves, the "all" and "uncommitted" views borrow the live model's
 * already-loaded change set so rows don't blink away on every switch or first
 * paint; a commit view has no model equivalent and loads. That borrowing stops
 * once a branch comparison has answered with an error: "all" then reports the
 * error with no rows instead of passing off working-tree edits as the branch.
 * A workspace with no base ref never issues that comparison, so it keeps
 * showing the working-tree set with no error.
 * @param workspace - Workspace whose changes are being reviewed
 * @returns The active source, the files and count it yields, and the source setter
 */
export function useChangesSource(workspace: WorkspaceShellModel) {
	const { t } = useTranslation();
	const sourceMap = useAtomValue(changesSourceByWorkspaceAtom);
	const storedSource = sourceMap[workspace.id];
	const source = useMemo<ChangesSource>(
		() => storedSource ?? { kind: 'all' },
		[storedSource],
	);
	const setSource = useSetChangesSource(workspace.id);

	const baseRef = workspace.landingSummary?.branchSource.baseBranch ?? null;
	// Only the turn source needs the checkpoint list, so it is not read until the
	// user picks that source.
	const latestTurn = useLatestTurnScope(
		workspace.id,
		source.kind === 'latest-turn',
	);
	// Until that list lands there is no turn to scope to, and the working-tree
	// scope below would answer with the user's own uncommitted edits under a
	// "Latest turn" heading. So the status read waits rather than degrading.
	const turnUnresolved = latestTurn.isPending || latestTurn.isError;
	const scope = useMemo(
		() => sourceToScope(source, baseRef, latestTurn.scope),
		[source, baseRef, latestTurn.scope],
	);

	const {
		data: sourceStatusData,
		isLoading: isSourceStatusLoading,
		isPlaceholderData: isSourceStatusPlaceholder,
	} = useQuery({
		...workspaceGitStatusQuery(workspace.pathLabel ?? null, scope),
		enabled: Boolean(workspace.pathLabel) && !turnUnresolved,
		placeholderData: keepPreviousData,
	});
	// `keepPreviousData` is what stops rows blinking away on a source switch, but
	// it also means the previous source's rows are still here while the turn is
	// unresolved — and showing those under a "Latest turn" heading is the very
	// thing the disabled read above avoids.
	const statusData =
		!turnUnresolved && sourceStatusData && !sourceStatusData.error
			? sourceStatusData
			: null;
	const hasLiveModelEquivalent =
		source.kind === 'all' || source.kind === 'uncommitted';
	const branchComparisonError =
		source.kind === 'all' &&
		scope.kind === 'branch' &&
		!isSourceStatusPlaceholder
			? sourceStatusData?.error
			: undefined;
	const useModelChanges =
		!statusData && hasLiveModelEquivalent && !branchComparisonError;

	const sourceFiles = useMemo(
		() =>
			statusData
				? mapGitStatusToReviewFiles(statusData.files)
				: useModelChanges
					? workspace.reviewFiles
					: [],
		[statusData, useModelChanges, workspace.reviewFiles],
	);

	return {
		changesCount: statusData
			? statusData.summary.files
			: useModelChanges
				? workspace.changeSummary.files
				: 0,
		// Only working-tree (uncommitted) files revert cleanly. The live model's
		// `reviewFiles` is exactly that set, so cross-reference it to decide which
		// rows expose a Discard action regardless of the active source.
		discardablePaths: useMemo(
			() => new Set(workspace.reviewFiles.map((file) => file.path)),
			[workspace.reviewFiles],
		),
		emptyState: useMemo(
			() => emptyStateForSource(t, source, latestTurn.isError),
			[t, source, latestTurn.isError],
		),
		isSourceLoading:
			!hasLiveModelEquivalent &&
			(isSourceStatusLoading || latestTurn.isPending),
		scope,
		setSource,
		source,
		latestTurnLabel: latestTurn.label,
		sourceError:
			branchComparisonError ??
			(hasLiveModelEquivalent
				? workspace.reviewFilesError
				: sourceStatusData?.error),
		sourceFiles,
	};
}
