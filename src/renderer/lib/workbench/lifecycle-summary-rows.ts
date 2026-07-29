import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { LifecycleSummaryRow } from '@/renderer/types/workbench-shell';

/**
 * Builds the summary rows for a workspace lifecycle dialog.
 * @param workspace - Workspace the dialog is about to archive or delete
 * @returns Name, branch, and worktree path rows, skipping an absent branch
 */
export function workspaceSummaryRows(
	workspace: WorkspaceShellModel,
): LifecycleSummaryRow[] {
	return [
		{ label: 'Workspace', value: workspace.name },
		...(workspace.branchName
			? [{ label: 'Branch', mono: true, value: workspace.branchName }]
			: []),
		{ label: 'Path', mono: true, value: workspace.pathLabel },
	];
}

/**
 * Builds the summary rows for a repository lifecycle dialog.
 * @param project - Repository the dialog is about to archive or delete
 * @returns Name and repository path rows
 */
export function projectSummaryRows(
	project: ProjectShellModel,
): LifecycleSummaryRow[] {
	return [
		{ label: 'Repository', value: project.name },
		{ label: 'Path', mono: true, value: project.pathLabel },
	];
}
