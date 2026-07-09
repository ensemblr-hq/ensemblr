import { useAtomValue } from 'jotai';

import { coloredSidebarDiffsAtom } from '@/renderer/state/preferences';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * Inline +/- diff stats for the workspace row. Colors the counts green/red only
 * when the row is active, or always when the "Colored sidebar diffs" appearance
 * pref is on; otherwise they render muted so inactive rows stay quiet.
 */
export function WorkspaceDiffStats({
	isActive,
	workspace,
}: {
	isActive: boolean;
	workspace: WorkspaceShellModel;
}) {
	const alwaysColored = useAtomValue(coloredSidebarDiffsAtom);
	const colored = alwaysColored || isActive;
	return (
		<div className='flex shrink-0 items-center gap-1.5 font-mono text-xxs leading-4'>
			{workspace.changeSummary.additions > 0 ? (
				<span className={colored ? 'text-status-ok' : 'text-muted-foreground'}>
					+{workspace.changeSummary.additions}
				</span>
			) : null}
			{workspace.changeSummary.deletions > 0 ? (
				<span
					className={colored ? 'text-status-danger' : 'text-muted-foreground'}
				>
					-{workspace.changeSummary.deletions}
				</span>
			) : null}
		</div>
	);
}
