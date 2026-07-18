import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationWorkspace,
} from '@/shared/ipc/contracts/repository-navigation';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

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

/** Carries a live change summary for one workspace. */
export interface WorkspaceChangeSummaryUpdate {
	changeSummary: WorkspaceShellModel['changeSummary'];
	workspaceId: string;
}

/** One workspace git-status query result, narrowed to the fields the merge reads. */
export interface WorkspaceChangeSummaryQueryResult {
	data?: {
		error?: unknown;
		summary: WorkspaceShellModel['changeSummary'];
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
				workspaceId: target.workspaceId,
			},
		];
	});
}

/** Applies live workspace change summaries to project models without mutating inputs. */
export function applyWorkspaceChangeSummaries(
	projects: ProjectShellModel[],
	updates: readonly WorkspaceChangeSummaryUpdate[],
): ProjectShellModel[] {
	if (updates.length === 0) {
		return projects;
	}

	const summariesByWorkspaceId = new Map(
		updates.map((update) => [update.workspaceId, update.changeSummary]),
	);
	let changedProjects = false;
	const nextProjects = projects.map((project) => {
		let changedWorkspaces = false;
		const workspaces = project.workspaces.map((workspace) => {
			const changeSummary = summariesByWorkspaceId.get(workspace.id);
			if (
				!changeSummary ||
				areChangeSummariesEqual(workspace.changeSummary, changeSummary)
			) {
				return workspace;
			}
			changedWorkspaces = true;
			return { ...workspace, changeSummary };
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
