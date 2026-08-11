import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, type NodeKey } from 'lexical';
import { useCallback } from 'react';

import { useFilePreviewOpener } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { attachmentPreviewPath } from '@/renderer/lib/workbench/composer-attachments';
import type { ComposerAttachment } from '@/renderer/types/workbench';

import { AttachmentChip } from '../attachment-chip';
import { PastedTextChip } from '../pasted-text-chip';

/**
 * The chip an {@link AttachmentNode} renders. Reaches for the editor and the
 * file-preview opener itself rather than taking them as props, because a
 * decorator is mounted by Lexical and has no parent to thread them through.
 */
export function DecoratedAttachmentChip({
	attachment,
	nodeKey,
}: {
	attachment: ComposerAttachment;
	nodeKey: NodeKey;
}) {
	const [editor] = useLexicalComposerContext();
	const openFilePreview = useFilePreviewOpener();

	const handleRemove = useCallback(() => {
		editor.update(() => {
			$getNodeByKey(nodeKey)?.remove();
		});
		editor.focus();
	}, [editor, nodeKey]);

	const previewPath = attachmentPreviewPath(attachment);
	const handleActivate =
		previewPath && openFilePreview
			? () => openFilePreview(previewPath)
			: undefined;

	if (attachment.kind === 'pasted-text') {
		return (
			<PastedTextChip
				lineCount={attachment.lineCount}
				onActivate={handleActivate}
				onRemove={handleRemove}
				preview={attachment.preview}
			/>
		);
	}
	return (
		<AttachmentChip
			attachment={attachment}
			onActivate={handleActivate}
			onRemove={handleRemove}
		/>
	);
}
