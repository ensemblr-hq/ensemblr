import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
	pullRequestSnapshotQuery,
	reviewCommentsQuery,
	reviewTodosQuery,
	workspaceFilesQuery,
	workspaceGitStatusQuery,
	workspaceScriptSettingsQuery,
} from '@/renderer/api/ensemble-queries';
import {
	buildWorkspaceScriptSummaries,
	scriptSummaryToDockStatus,
} from '@/renderer/lib/terminal/script-summaries';
import { mapTerminalSessionsToDockTabs } from '@/renderer/lib/terminal/terminal-tabs';
import type { WorkspaceNavigationSelection } from '@/renderer/lib/workbench';
import { buildPullRequestShellModel } from '@/renderer/lib/workbench/pull-request-model';
import type { useWorkspaceTerminalSessions } from '@/renderer/state/workspace/terminal-sessions';
import type { ReviewFileSummary } from '@/renderer/types/workbench';
import type { WorkspaceGitFileWire } from '@/shared/ipc';

type ActiveProject = WorkspaceNavigationSelection['project'];
type ActiveWorkspace = WorkspaceNavigationSelection['workspace'];
type TerminalSessions = ReturnType<typeof useWorkspaceTerminalSessions>;

/**
 * Assembles the live workspace shell model: merges git status, workspace
 * files, PR snapshot, and local review state into the placeholder workspace
 * so the route component stays pure composition.
 */
export function useLiveWorkspaceModel({
	activeProject,
	activeWorkspace,
	terminalSessions,
}: {
	activeProject: ActiveProject;
	activeWorkspace: ActiveWorkspace;
	terminalSessions: TerminalSessions;
}): {
	liveWorkspaceFiles: ActiveWorkspace['workspaceFiles'];
	workspaceWithLiveDockTabs: ActiveWorkspace;
} {
	const scriptSettingsQueryState = useQuery(
		workspaceScriptSettingsQuery({
			repositoryId: activeProject.id,
			repositoryPath: activeProject.pathLabel,
		}),
	);
	const gitStatusQueryState = useQuery(
		workspaceGitStatusQuery(activeWorkspace.pathLabel ?? null),
	);
	const allFilesQueryState = useQuery(
		workspaceFilesQuery(activeWorkspace.pathLabel ?? null),
	);
	const prSnapshotQueryState = useQuery(
		pullRequestSnapshotQuery({
			workspaceCwd: activeWorkspace.pathLabel ?? null,
			workspaceId: activeWorkspace.id,
		}),
	);
	const reviewTodosQueryState = useQuery(reviewTodosQuery(activeWorkspace.id));
	const reviewCommentsQueryState = useQuery(
		reviewCommentsQuery(activeWorkspace.id),
	);

	const liveWorkspaceFiles = useMemo(() => {
		const remote = allFilesQueryState.data?.files ?? [];
		if (remote.length === 0) {
			return activeWorkspace.workspaceFiles;
		}
		return remote.map((entry) => ({
			id: `wsfile:${entry.path}`,
			kind: entry.kind,
			name: entry.name,
			path: entry.path,
		}));
	}, [allFilesQueryState.data?.files, activeWorkspace.workspaceFiles]);

	const workspaceWithLiveDockTabs = useMemo<ActiveWorkspace>(() => {
		const scripts = buildWorkspaceScriptSummaries({
			sessions: terminalSessions.sessions,
			settings: scriptSettingsQueryState.data ?? null,
		});
		const gitStatus = gitStatusQueryState.data;
		const liveReview = gitStatus
			? gitStatus.error
				? { reviewFilesError: gitStatus.error.message }
				: {
						changeSummary: {
							additions: gitStatus.summary.additions,
							deletions: gitStatus.summary.deletions,
							files: gitStatus.summary.files,
						},
						reviewFiles: mapGitStatusToReviewFiles(gitStatus.files),
					}
			: {};
		const changeSummary =
			'changeSummary' in liveReview && liveReview.changeSummary
				? liveReview.changeSummary
				: activeWorkspace.changeSummary;
		const prResult = prSnapshotQueryState.data;
		const pullRequest = prResult
			? buildPullRequestShellModel({
					changeSummary,
					localComments: reviewCommentsQueryState.data?.comments ?? [],
					snapshot: prResult.snapshot,
					...(prResult.error ? { syncError: prResult.error.message } : {}),
					todos: reviewTodosQueryState.data?.todos ?? [],
				})
			: activeWorkspace.pullRequest;

		return {
			...activeWorkspace,
			dockTabs: [
				...activeWorkspace.dockTabs
					.filter((tab) => tab.kind !== 'terminal')
					.map((tab) =>
						tab.kind === 'setup-script'
							? { ...tab, status: scriptSummaryToDockStatus(scripts.setup) }
							: tab.kind === 'run-script'
								? { ...tab, status: scriptSummaryToDockStatus(scripts.run) }
								: tab,
					),
				...mapTerminalSessionsToDockTabs(terminalSessions.sessions),
			],
			...liveReview,
			pullRequest,
			scripts,
			workspaceFiles: liveWorkspaceFiles,
		};
	}, [
		activeWorkspace,
		gitStatusQueryState.data,
		liveWorkspaceFiles,
		prSnapshotQueryState.data,
		reviewCommentsQueryState.data?.comments,
		reviewTodosQueryState.data?.todos,
		scriptSettingsQueryState.data,
		terminalSessions.sessions,
	]);

	return { liveWorkspaceFiles, workspaceWithLiveDockTabs };
}

/** Maps git status wire rows to the review panel's changed-file summaries. */
function mapGitStatusToReviewFiles(
	files: readonly WorkspaceGitFileWire[],
): ReviewFileSummary[] {
	return files.flatMap((file) =>
		file.status === 'ignored'
			? []
			: [
					{
						additions: file.additions ?? 0,
						deletions: file.deletions ?? 0,
						id: `git:${file.path}`,
						path: file.path,
						status:
							file.status === 'conflicted'
								? ('modified' as const)
								: file.status,
					},
				],
	);
}
