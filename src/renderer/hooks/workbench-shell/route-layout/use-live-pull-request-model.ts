import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
	pullRequestSnapshotQuery,
	reviewCommentsQuery,
	reviewTodosQuery,
} from '@/renderer/api/ensemblr-queries';
import { buildPullRequestShellModel } from '@/renderer/lib/workbench/pull-request-model';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

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
 * Returns `fallback` unchanged (same reference) until a snapshot lands, and when
 * `enabled` is false, so inactive rows never subscribe or allocate a new model.
 *
 * The model it builds carries already-translated labels, so the active language
 * is one of the memo's inputs and a language switch rebuilds it.
 *
 * @param changeSummary - Branch change counts folded into the PR git-status row.
 * @param enabled - Whether to subscribe to the live queries; false yields the fallback.
 * @param fallback - PR model to return before the snapshot is available.
 * @param workspaceCwd - Worktree path used by the snapshot query function.
 * @param workspaceId - Workspace id the PR queries are keyed by.
 * @returns The live PR model, or the fallback when no snapshot is loaded yet.
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
		if (!enabled || !prSnapshotData) {
			return fallback;
		}
		return buildPullRequestShellModel({
			changeSummary,
			localComments: reviewCommentsData?.comments ?? [],
			snapshot: prSnapshotData.snapshot,
			...(prSnapshotData.error ? { syncFailure: prSnapshotData.error } : {}),
			todos: reviewTodosData?.todos ?? [],
		});
	}, [
		changeSummary,
		enabled,
		fallback,
		i18n.language,
		prSnapshotData,
		reviewCommentsData?.comments,
		reviewTodosData?.todos,
	]);
}
