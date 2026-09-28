import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationWorkspace,
} from '@/shared/ipc/contracts/repository-navigation';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

import { buildGitStatus } from './pull-request-model';

/**
 * Identifies a workspace whose sidebar/board change summary should be refreshed.
 * Every target carries a branch scope so all overview summaries share one
 * meaning (`baseRef..HEAD`); workspaces with no resolvable base are omitted
 * rather than silently falling back to a working-tree diff.
 */
export interface WorkspaceChangeSummaryTarget {
	scope: WorkspaceGitDiffScope;
	workspaceCwd: string;
	workspaceId: string;
}

/**
 * Carries a live change summary for one workspace, plus the uncommitted file
 * count the same branch read reports when git could read the working tree.
 */
export interface WorkspaceChangeSummaryUpdate {
	changeSummary: WorkspaceShellModel['changeSummary'];
	uncommittedFiles?: number;
	workspaceId: string;
}

/** One workspace git-status query result, narrowed to the fields the merge reads. */
export interface WorkspaceChangeSummaryQueryResult {
	data?: {
		error?: unknown;
		summary: WorkspaceShellModel['changeSummary'];
		uncommittedFiles?: number;
	};
}

/** Builds branch-scoped git-status query targets for every navigation workspace. */
export function getNavigationWorkspaceChangeSummaryTargets(
	repositories?: readonly RepositoryWorkspaceNavigationRepository[] | null,
): WorkspaceChangeSummaryTarget[] {
	return (
		repositories?.flatMap((repository) =>
			repository.workspaces.flatMap((workspace) => {
				const scope = getNavigationWorkspaceDiffScope(repository, workspace);
				if (!scope) {
					return [];
				}
				return [
					{ scope, workspaceCwd: workspace.path, workspaceId: workspace.id },
				];
			}),
		) ?? []
	);
}

/** Maps git-status query results back to change-summary updates by target index. */
export function collectWorkspaceChangeSummaryUpdates(
	results: readonly WorkspaceChangeSummaryQueryResult[],
	targets: readonly WorkspaceChangeSummaryTarget[],
): WorkspaceChangeSummaryUpdate[] {
	return results.flatMap((result, index) => {
		const data = result.data;
		const target = targets[index];
		if (!data || data.error || !target) {
			return [];
		}
		return [
			{
				changeSummary: {
					additions: data.summary.additions,
					deletions: data.summary.deletions,
					files: data.summary.files,
				},
				...(data.uncommittedFiles === undefined
					? {}
					: { uncommittedFiles: data.uncommittedFiles }),
				workspaceId: target.workspaceId,
			},
		];
	});
}

/**
 * Applies live workspace change summaries to project models without mutating
 * inputs. Every update is applied to the navigation-mapped projects afresh, so
 * a count that drops back to zero leaves the mapper's own git-status row.
 */
export function applyWorkspaceChangeSummaries(
	projects: ProjectShellModel[],
	updates: readonly WorkspaceChangeSummaryUpdate[],
): ProjectShellModel[] {
	if (updates.length === 0) {
		return projects;
	}

	const updatesByWorkspaceId = new Map(
		updates.map((update) => [update.workspaceId, update]),
	);
	let changedProjects = false;
	const nextProjects = projects.map((project) => {
		let changedWorkspaces = false;
		const workspaces = project.workspaces.map((workspace) => {
			const update = updatesByWorkspaceId.get(workspace.id);
			if (!update || isUpdateApplied(workspace, update)) {
				return workspace;
			}
			changedWorkspaces = true;
			return withChangeSummaryUpdate(workspace, update);
		});

		if (!changedWorkspaces) {
			return project;
		}
		changedProjects = true;
		return { ...project, workspaces };
	});

	return changedProjects ? nextProjects : projects;
}

/** Resolves the full-workspace diff scope for a navigation workspace. */
function getNavigationWorkspaceDiffScope(
	repository: RepositoryWorkspaceNavigationRepository,
	workspace: RepositoryWorkspaceNavigationWorkspace,
): WorkspaceGitDiffScope | undefined {
	const baseRef = workspace.baseBranch ?? repository.defaultBranch;

	return baseRef ? { baseRef, kind: 'branch' } : undefined;
}

/**
 * Folds one overview reading into a workspace row. An uncommitted count also
 * rebuilds the pull request's git-status row, which the navigation mapper could
 * only build from the branch's sync state: without it a workspace holding
 * uncommitted work reads as ready to merge the moment it is not the one open.
 * @param workspace - The navigation-mapped workspace row
 * @param update - The overview reading for that workspace
 * @returns A new row carrying the reading
 */
function withChangeSummaryUpdate(
	workspace: WorkspaceShellModel,
	update: WorkspaceChangeSummaryUpdate,
): WorkspaceShellModel {
	const { uncommittedFiles } = update;
	if (uncommittedFiles === undefined) {
		return { ...workspace, changeSummary: update.changeSummary };
	}
	return {
		...workspace,
		changeSummary: update.changeSummary,
		pullRequest:
			uncommittedFiles > 0
				? {
						...workspace.pullRequest,
						gitStatus: buildGitStatus(
							{ additions: 0, deletions: 0, files: uncommittedFiles },
							null,
						),
					}
				: workspace.pullRequest,
		uncommittedFiles,
	};
}

/**
 * Whether a row already carries everything an update would write.
 * @param workspace - The workspace row
 * @param update - The overview reading for that workspace
 * @returns True when applying the update would change nothing
 */
function isUpdateApplied(
	workspace: WorkspaceShellModel,
	update: WorkspaceChangeSummaryUpdate,
): boolean {
	return (
		areChangeSummariesEqual(workspace.changeSummary, update.changeSummary) &&
		(update.uncommittedFiles === undefined ||
			workspace.uncommittedFiles === update.uncommittedFiles)
	);
}

/** Compares change-summary values for structural equality. */
function areChangeSummariesEqual(
	left: WorkspaceShellModel['changeSummary'],
	right: WorkspaceShellModel['changeSummary'],
): boolean {
	return (
		left.additions === right.additions &&
		left.deletions === right.deletions &&
		left.files === right.files
	);
}
