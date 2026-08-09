import { CopyIcon, EyeIcon, PinIcon, Undo2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
} from '@/renderer/components/ui/context-menu';

import type { ReviewFileMenuTarget } from '@/renderer/types/workbench';

import { OpenInTargetsSubmenu } from './open-in-targets-submenu';
import { useReviewFileActions } from './review-file-actions-context';

/**
 * Single shared right-click menu for the changes panel: View (the file's diff,
 * or its image preview) and Keep open (the same, as a permanent tab), "Open in
 * <app>" for every installed target, Copy path, and Discard changes — scoped to
 * whichever row the user right-clicked. Keep open is the keyboard-reachable
 * equivalent of double-clicking the row.
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
	const { t } = useTranslation();
	const {
		copyTarget,
		invokeTarget,
		isDiscardable,
		onDiscardFile,
		openFile,
		openInTargets,
	} = useReviewFileActions();

	if (!target) {
		return null;
	}

	const path = target.path;
	const canDiscard = isDiscardable(path);
	const invoke = (targetId: Parameters<typeof invokeTarget>[0]) =>
		void invokeTarget(targetId, {
			relativePath: path,
			relativePathKind: 'file',
		});

	return (
		<ContextMenuContent
			aria-label={t('review:file-menu.actions', '{{path}} actions', { path })}
			className='w-48 bg-muted p-1'
		>
			{openFile ? (
				<>
					<ContextMenuItem
						className='h-8 gap-2 px-2 text-[0.8125rem]'
						onSelect={() => openFile(path)}
					>
						<EyeIcon aria-hidden='true' className='text-muted-foreground' />
						<span className='min-w-0 flex-1'>
							{t('common:actions.view', 'View')}
						</span>
					</ContextMenuItem>
					<ContextMenuItem
						className='h-8 gap-2 px-2 text-[0.8125rem]'
						onSelect={() => openFile(path, { preview: false })}
					>
						<PinIcon aria-hidden='true' className='text-muted-foreground' />
						<span className='min-w-0 flex-1'>
							{t('common:actions.keep-open', 'Keep open')}
						</span>
					</ContextMenuItem>
				</>
			) : null}
			<OpenInTargetsSubmenu onSelect={invoke} openInTargets={openInTargets} />
			{copyTarget ? (
				<ContextMenuItem
					className='h-8 gap-2 px-2 text-[0.8125rem]'
					onSelect={() => invoke(copyTarget)}
				>
					<CopyIcon aria-hidden='true' className='text-muted-foreground' />
					<span className='min-w-0 flex-1'>
						{t('common:actions.copy-path', 'Copy path')}
					</span>
				</ContextMenuItem>
			) : null}
			{canDiscard ? (
				<>
					<ContextMenuSeparator />
					<ContextMenuItem
						className='h-8 gap-2 px-2 text-[0.8125rem]'
						onSelect={() => onDiscardFile(path)}
					>
						<Undo2Icon aria-hidden='true' className='text-muted-foreground' />
						<span className='min-w-0 flex-1'>
							{t('common:actions.discard-changes', 'Discard changes')}
						</span>
					</ContextMenuItem>
				</>
			) : null}
		</ContextMenuContent>
	);
}
