import { CopyIcon, PaperclipIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
	ContextMenuContent,
	ContextMenuSeparator,
} from '@/renderer/components/ui/context-menu';
import type {
	FileTreeMenuTarget,
	OpenTargetsState,
	ReviewFilePreviewOpener,
	WorkspaceOpenTarget,
} from '@/renderer/types/workbench';

import { FileMenuItem, OpenFileMenuItems } from './file-menu-items';
import { OpenInTargetsSubmenu } from './open-in-targets-submenu';

/**
 * Renders the single shared right-click menu for the all-files tree: View and
 * Keep open for file rows, "Attach to chat", "Open in <app>" for every installed
 * target, plus "Copy path", scoped to whichever row the user right-clicked. Keep
 * open is the keyboard-reachable equivalent of double-clicking the row.
 *
 * One menu serves the whole tree (the row that was clicked is captured into
 * `target`) instead of mounting a Radix `ContextMenu` per row, so thousands of
 * rows no longer each carry a menu state machine. Renders nothing until a row
 * is targeted.
 * @param copyTarget - The copy-path target, if available.
 * @param invokeTarget - Runs the chosen target against `target`'s path.
 * @param onAttachToChat - Attaches the row to the workspace's composer as a chip.
 * @param openFilePreview - Opens a file row in the workbench, or `null` outside a conversation.
 * @param openInTargets - Installed "open in" targets (copy-path excluded).
 * @param target - The right-clicked row, or `null` when none.
 */
export function AllFilesContextMenuContent({
	copyTarget,
	invokeTarget,
	onAttachToChat,
	openFilePreview,
	openInTargets,
	target,
}: {
	copyTarget: WorkspaceOpenTarget | undefined;
	invokeTarget: OpenTargetsState['invokeTarget'];
	onAttachToChat: (target: FileTreeMenuTarget) => void;
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
				<OpenFileMenuItems openFile={openFilePreview} path={path} />
			) : null}
			<FileMenuItem
				icon={PaperclipIcon}
				label={t('common:actions.attach-to-chat', 'Attach to chat')}
				onSelect={() => onAttachToChat(target)}
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
		</ContextMenuContent>
	);
}
