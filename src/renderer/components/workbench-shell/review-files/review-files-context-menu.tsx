import { ArrowUpRightIcon, CopyIcon, EyeIcon, Undo2Icon } from 'lucide-react';

import {
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from '@/renderer/components/ui/context-menu';
import { OpenTargetIcon } from '@/renderer/components/workbench-shell/open-target-icon';

import { useReviewFileActions } from './review-file-actions-context';

/** The changed file a right-click opened the shared menu against. */
export interface ReviewFileMenuTarget {
	path: string;
}

/**
 * Single shared right-click menu for the changes panel: View (open diff), "Open
 * in <app>" for every installed target, Copy path, and Discard changes — scoped
 * to whichever row the user right-clicked.
 *
 * One menu serves the whole list (the clicked row is captured into `target`)
 * instead of mounting a Radix menu per row. Renders nothing until a row is
 * targeted.
 */
export function ReviewFilesContextMenuContent({
	target,
}: {
	target: ReviewFileMenuTarget | null;
}) {
	const { copyTarget, invokeTarget, onDiscardFile, openDiff, openInTargets } =
		useReviewFileActions();

	if (!target) {
		return null;
	}

	const path = target.path;
	const invoke = (targetId: Parameters<typeof invokeTarget>[0]) =>
		void invokeTarget(targetId, {
			relativePath: path,
			relativePathKind: 'file',
		});

	return (
		<ContextMenuContent
			aria-label={`${path} actions`}
			className='w-48 bg-muted p-1'
		>
			{openDiff ? (
				<ContextMenuItem
					className='h-8 gap-2 px-2 text-[0.8125rem]'
					onSelect={() => openDiff(path)}
				>
					<EyeIcon aria-hidden='true' className='text-muted-foreground' />
					<span className='min-w-0 flex-1'>View</span>
				</ContextMenuItem>
			) : null}
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
			<ContextMenuSeparator />
			<ContextMenuItem
				className='h-8 gap-2 px-2 text-[0.8125rem]'
				onSelect={() => onDiscardFile(path)}
			>
				<Undo2Icon aria-hidden='true' className='text-muted-foreground' />
				<span className='min-w-0 flex-1'>Discard changes</span>
			</ContextMenuItem>
		</ContextMenuContent>
	);
}
