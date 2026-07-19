import { ArrowUpRightIcon } from 'lucide-react';

import {
	ContextMenuItem,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from '@/renderer/components/ui/context-menu';
import { OpenTargetIcon } from '@/renderer/components/workbench-shell/open-target-icon';
import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';

/**
 * "Open in <app>" submenu shared by the all-files tree and changes context
 * menus: one nested entry per installed open target, each showing its icon,
 * label, and number-shortcut hint. Renders nothing when no targets are
 * installed.
 */
export function OpenInTargetsSubmenu({
	onSelect,
	openInTargets,
}: {
	onSelect: (openTarget: WorkspaceOpenTarget) => void;
	openInTargets: readonly WorkspaceOpenTarget[];
}) {
	if (!openInTargets.length) {
		return null;
	}

	return (
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
						onSelect={() => onSelect(openTarget)}
					>
						<OpenTargetIcon className='size-4' target={openTarget} />
						<span className='min-w-0 flex-1 truncate'>{openTarget.label}</span>
						<span className='w-3.5 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
							{openTarget.numberShortcutLabel}
						</span>
					</ContextMenuItem>
				))}
			</ContextMenuSubContent>
		</ContextMenuSub>
	);
}
