import { CopyIcon, PaperclipIcon, Undo2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ContextMenuSeparator } from '@/renderer/components/ui/context-menu';
import { WorkbenchContextMenuContent } from '@/renderer/components/workbench-shell/workbench-context-menu-content';

import type { ReviewFileMenuTarget } from '@/renderer/types/workbench';

import { FileMenuItem, OpenFileMenuItems } from './file-menu-items';
import { OpenInTargetsSubmenu } from './open-in-targets-submenu';
import { useReviewFileActions } from './review-file-actions-context';

/**
 * Single shared right-click menu for the changes panel: View (the file's diff,
 * or its image preview) and Keep open (the same, as a permanent tab), "Attach
 * diff to chat", "Open in <app>" for every installed target, Copy path, and
 * Discard changes — scoped to whichever row the user right-clicked. Keep open is
 * the keyboard-reachable equivalent of double-clicking the row.
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
		attachDiff,
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
		<WorkbenchContextMenuContent
			aria-label={t('review:file-menu.actions', '{{path}} actions', { path })}
			className='min-w-48'
		>
			{openFile ? <OpenFileMenuItems openFile={openFile} path={path} /> : null}
			<FileMenuItem
				icon={PaperclipIcon}
				label={t('review:file-menu.attach-diff-to-chat', 'Attach diff to chat')}
				onSelect={() => attachDiff(path)}
			/>
			{openInTargets.length || copyTarget ? <ContextMenuSeparator /> : null}
			<OpenInTargetsSubmenu onSelect={invoke} openInTargets={openInTargets} />
			{copyTarget ? (
				<FileMenuItem
					icon={CopyIcon}
					label={t('common:actions.copy-path', 'Copy path')}
					onSelect={() => invoke(copyTarget)}
				/>
			) : null}
			{canDiscard ? (
				<>
					<ContextMenuSeparator />
					<FileMenuItem
						icon={Undo2Icon}
						label={t('common:actions.discard-changes', 'Discard changes')}
						onSelect={() => onDiscardFile(path)}
					/>
				</>
			) : null}
		</WorkbenchContextMenuContent>
	);
}
