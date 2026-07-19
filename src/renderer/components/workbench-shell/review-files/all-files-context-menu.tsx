import { CopyIcon } from 'lucide-react';

import {
	ContextMenuContent,
	ContextMenuItem,
} from '@/renderer/components/ui/context-menu';
import type {
	FileTreeMenuTarget,
	OpenTargetsState,
	WorkspaceOpenTarget,
} from '@/renderer/types/workbench';

import { OpenInTargetsSubmenu } from './open-in-targets-submenu';

/**
 * Renders the single shared right-click menu for the all-files tree: "Open in
 * <app>" for every installed target plus "Copy path", scoped to whichever row
 * the user right-clicked.
 *
 * One menu serves the whole tree (the row that was clicked is captured into
 * `target`) instead of mounting a Radix `ContextMenu` per row, so thousands of
 * rows no longer each carry a menu state machine. Renders nothing until a row
 * is targeted.
 * @param copyTarget - The copy-path target, if available.
 * @param invokeTarget - Runs the chosen target against `target`'s path.
 * @param openInTargets - Installed "open in" targets (copy-path excluded).
 * @param target - The right-clicked row, or `null` when none.
 */
export function AllFilesContextMenuContent({
	copyTarget,
	invokeTarget,
	openInTargets,
	target,
}: {
	copyTarget: WorkspaceOpenTarget | undefined;
	invokeTarget: OpenTargetsState['invokeTarget'];
	openInTargets: readonly WorkspaceOpenTarget[];
	target: FileTreeMenuTarget | null;
}) {
	if (!target) {
		return null;
	}

	const invoke = (openTarget: WorkspaceOpenTarget) =>
		void invokeTarget(openTarget, {
			relativePath: target.relativePath,
			relativePathKind: target.relativePathKind,
		});

	return (
		<ContextMenuContent
			aria-label={`${target.relativePath} actions`}
			className='w-44 bg-muted p-1'
		>
			<OpenInTargetsSubmenu onSelect={invoke} openInTargets={openInTargets} />
			{copyTarget ? (
				<ContextMenuItem
					className='h-8 gap-2 px-2 text-[0.8125rem]'
					onSelect={() => invoke(copyTarget)}
				>
					<CopyIcon aria-hidden='true' className='text-muted-foreground' />
					<span className='min-w-0 flex-1'>Copy path</span>
				</ContextMenuItem>
			) : null}
		</ContextMenuContent>
	);
}
