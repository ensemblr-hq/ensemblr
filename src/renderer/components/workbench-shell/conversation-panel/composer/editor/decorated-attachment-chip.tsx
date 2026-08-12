import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, type NodeKey } from 'lexical';
import { useCallback } from 'react';

import {
	useCommentPreviewOpener,
	useFilePreviewOpener,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { attachmentPreviewPath } from '@/renderer/lib/workbench/composer-attachments';
import type { ComposerAttachment } from '@/renderer/types/workbench';

import { AttachmentChip } from '../attachment-chip';
import { PastedTextChip } from '../pasted-text-chip';

/**
 * The chip an {@link AttachmentNode} renders. Reaches for the editor and the
 * preview openers itself rather than taking them as props, because a decorator
 * is mounted by Lexical and has no parent to thread them through.
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
	const openCommentPreview = useCommentPreviewOpener();

	const handleRemove = useCallback(() => {
		editor.update(() => {
			$getNodeByKey(nodeKey)?.remove();
		});
		editor.focus();
	}, [editor, nodeKey]);

	const handleActivate = resolveChipActivation({
		attachment,
		openCommentPreview,
		openFilePreview,
	});

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

/**
 * What a click on the chip does: a review comment opens its own preview panel,
 * because the markdown document it was written to is a serialization detail the
 * user never asked to read; everything else opens in the file preview. Undefined
 * when the surrounding workspace offers no opener, which renders the chip inert.
 * @param attachment - The attachment behind the chip
 * @param openCommentPreview - Comment preview opener, or null outside a workspace
 * @param openFilePreview - File preview opener, or null outside a conversation
 * @returns The activation handler, or undefined when there is nothing to open
 */
function resolveChipActivation({
	attachment,
	openCommentPreview,
	openFilePreview,
}: {
	attachment: ComposerAttachment;
	openCommentPreview: ReturnType<typeof useCommentPreviewOpener>;
	openFilePreview: ReturnType<typeof useFilePreviewOpener>;
}): (() => void) | undefined {
	if (attachment.kind === 'review-comment') {
		if (!openCommentPreview) {
			return undefined;
		}
		const { comment } = attachment;
		return () => openCommentPreview({ comment, prNumber: comment.prNumber });
	}
	const previewPath = attachmentPreviewPath(attachment);
	if (!(previewPath && openFilePreview)) {
		return undefined;
	}
	return () => openFilePreview(previewPath);
}
