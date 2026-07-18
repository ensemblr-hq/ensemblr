import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/** Inline +/- diff stats for the workspace row with additions green and deletions red. */
export function WorkspaceDiffStats({
	workspace,
}: {
	workspace: WorkspaceShellModel;
}) {
	return (
		<div className='flex shrink-0 items-center gap-1.5 font-mono text-xxs leading-4'>
			{workspace.changeSummary.additions > 0 ? (
				<span className='text-status-ok'>
					+{workspace.changeSummary.additions}
				</span>
			) : null}
			{workspace.changeSummary.deletions > 0 ? (
				<span className='text-status-danger'>
					-{workspace.changeSummary.deletions}
				</span>
			) : null}
		</div>
	);
}
