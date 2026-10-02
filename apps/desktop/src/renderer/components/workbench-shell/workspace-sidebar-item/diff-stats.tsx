import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * Inline +/- diff stats for the workspace row, hued from the same
 * addition/deletion tokens the diff surfaces paint with, so a count and the lines
 * it describes keep one colour through every colorblind mode.
 */
export function WorkspaceDiffStats({
	workspace,
}: {
	workspace: WorkspaceShellModel;
}) {
	return (
		<div className='flex shrink-0 items-center gap-1.5 font-mono text-xxs tabular-nums leading-4'>
			{workspace.changeSummary.additions > 0 ? (
				<span className='text-diff-addition-foreground'>
					+{workspace.changeSummary.additions}
				</span>
			) : null}
			{workspace.changeSummary.deletions > 0 ? (
				<span className='text-diff-deletion-foreground'>
					-{workspace.changeSummary.deletions}
				</span>
			) : null}
		</div>
	);
}
