import { ArrowUpRightIcon, CopyIcon } from 'lucide-react';

import {
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from '@/renderer/components/ui/context-menu';
import { OpenTargetIcon } from '@/renderer/components/workbench-shell/open-target-icon';
import type { OpenTargetsState } from '@/renderer/hooks/workbench-shell/use-open-targets';
import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';

/** The file/folder a right-click opened the shared tree menu against. */
export interface FileTreeMenuTarget {
	relativePath: string;
	relativePathKind: 'directory' | 'file';
}

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
			{openInTargets.length ? (
				<ContextMenuSub>
					<ContextMenuSubTrigger className='h-8 gap-2 px-2 text-[0.8125rem]'>
						<ArrowUpRightIcon
							aria-hidden='true'
							className='text-muted-foreground'
						/>
						<span className='min-w-0 flex-1'>Open in</span>
					</ContextMenuSubTrigger>
					<ContextMenuSubContent className='w-60 bg-muted p-1'>
						{openInTargets.map((openTarget) => (
							<ContextMenuItem
								className='h-8 gap-2.5 px-2 text-[0.8125rem]'
								key={openTarget.id}
								onSelect={() => invoke(openTarget)}
							>
								<OpenTargetIcon className='size-4' target={openTarget} />
								<span className='min-w-0 flex-1 truncate'>
									{openTarget.label}
								</span>
								<span className='w-3.5 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
									{openTarget.numberShortcutLabel}
								</span>
							</ContextMenuItem>
						))}
					</ContextMenuSubContent>
				</ContextMenuSub>
			) : null}
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
