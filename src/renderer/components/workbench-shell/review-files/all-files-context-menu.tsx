import { CopyIcon, EyeIcon, PinIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
} from '@/renderer/components/ui/context-menu';
import type {
	FileTreeMenuTarget,
	OpenTargetsState,
	ReviewFilePreviewOpener,
	WorkspaceOpenTarget,
} from '@/renderer/types/workbench';

import { OpenInTargetsSubmenu } from './open-in-targets-submenu';

/**
 * Renders the single shared right-click menu for the all-files tree: View and
 * Keep open for file rows, "Open in <app>" for every installed target, plus
 * "Copy path", scoped to whichever row the user right-clicked. Keep open is the
 * keyboard-reachable equivalent of double-clicking the row.
 *
 * One menu serves the whole tree (the row that was clicked is captured into
 * `target`) instead of mounting a Radix `ContextMenu` per row, so thousands of
 * rows no longer each carry a menu state machine. Renders nothing until a row
 * is targeted.
 * @param copyTarget - The copy-path target, if available.
 * @param invokeTarget - Runs the chosen target against `target`'s path.
 * @param openFilePreview - Opens a file row in the workbench, or `null` outside a conversation.
 * @param openInTargets - Installed "open in" targets (copy-path excluded).
 * @param target - The right-clicked row, or `null` when none.
 */
export function AllFilesContextMenuContent({
	copyTarget,
	invokeTarget,
	openFilePreview,
	openInTargets,
	target,
}: {
	copyTarget: WorkspaceOpenTarget | undefined;
	invokeTarget: OpenTargetsState['invokeTarget'];
	openFilePreview: ReviewFilePreviewOpener | null;
	openInTargets: readonly WorkspaceOpenTarget[];
	target: FileTreeMenuTarget | null;
}) {
	const { t } = useTranslation();

	if (!target) {
		return null;
	}

	const path = target.relativePath;
	const canOpen = openFilePreview && target.relativePathKind === 'file';
	const invoke = (openTarget: WorkspaceOpenTarget) =>
		void invokeTarget(openTarget, {
			relativePath: path,
			relativePathKind: target.relativePathKind,
		});

	return (
		<ContextMenuContent
			aria-label={t('workbench:file-tree-menu.actions', '{{path}} actions', {
				path,
			})}
			className='w-44 bg-muted p-1'
		>
			{canOpen ? (
				<>
					<ContextMenuItem
						className='h-8 gap-2 px-2 text-[0.8125rem]'
						onSelect={() => openFilePreview(path)}
					>
						<EyeIcon aria-hidden='true' className='text-muted-foreground' />
						<span className='min-w-0 flex-1'>
							{t('common:actions.view', 'View')}
						</span>
					</ContextMenuItem>
					<ContextMenuItem
						className='h-8 gap-2 px-2 text-[0.8125rem]'
						onSelect={() => openFilePreview(path, { preview: false })}
					>
						<PinIcon aria-hidden='true' className='text-muted-foreground' />
						<span className='min-w-0 flex-1'>
							{t('common:actions.keep-open', 'Keep open')}
						</span>
					</ContextMenuItem>
					{openInTargets.length || copyTarget ? <ContextMenuSeparator /> : null}
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
		</ContextMenuContent>
	);
}
