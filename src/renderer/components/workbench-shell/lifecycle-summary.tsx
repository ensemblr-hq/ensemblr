import { Fragment } from 'react';

import { cn } from '@/renderer/lib/utils';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/** One label/value pair in a lifecycle dialog summary; `mono` marks machine values such as branches and paths. */
export interface LifecycleSummaryRow {
	label: string;
	mono?: boolean;
	value: string;
}

/**
 * Identity card shared by the archive and delete dialogs so every confirmation
 * names its exact target. Values wrap instead of stretching the dialog, which
 * keeps long absolute paths readable in full.
 */
export function LifecycleSummary({ rows }: { rows: LifecycleSummaryRow[] }) {
	return (
		<dl className='grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs'>
			{rows.map((row) => (
				<Fragment key={row.label}>
					<dt className='text-muted-foreground'>{row.label}</dt>
					<dd
						className={cn(
							'wrap-anywhere',
							row.mono && 'font-mono text-[0.6875rem] leading-normal',
						)}
					>
						{row.value}
					</dd>
				</Fragment>
			))}
		</dl>
	);
}

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
