import { useAtomValue } from 'jotai';
import {
	type ChangeEvent,
	type DragEvent as ReactDragEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

import type { ComposerEditorHandle } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import {
	attachPastedFiles,
	attachPastedText,
	getTransferFiles,
} from '@/renderer/lib/workbench/composer-attachments';
import {
	composerAttachmentsAtomFamily,
	useComposerAttachmentInbox,
} from '@/renderer/state/composer';
import { autoConvertLongTextAtom } from '@/renderer/state/preferences';
import type { ComposerAttachment } from '@/renderer/types/workbench';

/**
 * Pasted text at or above this length is converted into a `.txt` attachment
 * instead of being inlined, so a wall of pasted output does not bury the draft.
 */
const PASTE_ATTACHMENT_THRESHOLD = 5_000;

/**
 * The composer's attachment list and every way the user adds to or removes from
 * it: the file picker, paste (files and long-text conversion), drag-and-drop,
 * and the cross-component inbox other panels push through.
 *
 * The chips themselves live in the editor document, at the position the user put
 * them, so every mutation here is an editor operation and the atom this reads is
 * the mirror the editor publishes. Everything is written to the workspace's
 * content-addressed store the moment it is attached, so every chip carries a
 * real path and re-attaching the same bytes costs nothing.
 * @param chatTabId - Chat tab the attachment list is scoped to
 * @param editorRef - Handle onto the draft the chips are inserted into
 * @param insertPlainText - Fallback for a long paste whose write failed
 * @param workspaceCwd - Absolute workspace path pasted files are saved under
 * @returns The list, the pending error, and the DOM handlers
 */
export function useComposerAttachments({
	chatTabId,
	editorRef,
	insertPlainText,
	workspaceCwd,
}: {
	chatTabId: string;
	editorRef: RefObject<ComposerEditorHandle | null>;
	insertPlainText: (text: string) => void;
	workspaceCwd: string;
}) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const attachments = useAtomValue(composerAttachmentsAtomFamily(chatTabId));
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const autoConvertLong = useAtomValue(autoConvertLongTextAtom);

	const addAttachments = useCallback(
		(incoming: readonly ComposerAttachment[]) => {
			for (const entry of incoming) {
				editorRef.current?.insertAttachment(entry);
			}
		},
		[editorRef],
	);

	// Drain externally-pushed attachments (transcript chips, plan handoff, fork).
	const attachmentInbox = useComposerAttachmentInbox(chatTabId, workspaceCwd);
	useEffect(() => {
		if (attachmentInbox.pending.length === 0) {
			return;
		}
		for (const entry of attachmentInbox.pending) {
			editorRef.current?.insertAttachment(entry);
		}
		attachmentInbox.clear();
	}, [attachmentInbox, editorRef]);

	const handlePastedFiles = useCallback(
		async (files: readonly File[]) => {
			setAttachmentError(null);
			const result = await attachPastedFiles(files, workspaceCwd);
			if (result.error) {
				setAttachmentError(result.error);
			}
			if (result.attachments.length > 0) {
				addAttachments(result.attachments);
			}
		},
		[addAttachments, workspaceCwd],
	);

	/**
	 * Converts a long paste into a stored attachment. A write that fails puts the
	 * text back in the draft rather than surfacing an error: the paste already
	 * had its default prevented, so dropping it would lose the user's clipboard.
	 */
	const handlePastedText = useCallback(
		async (text: string) => {
			setAttachmentError(null);
			try {
				addAttachments([await attachPastedText(text, workspaceCwd)]);
			} catch {
				insertPlainText(text);
			}
		},
		[addAttachments, insertPlainText, workspaceCwd],
	);

	/**
	 * Claims a pasted payload the editor should not inline: any file, and a
	 * paste long enough to bury the draft.
	 * @param data - The clipboard payload
	 * @returns True when the paste was taken over as an attachment
	 */
	const consumePastedTransfer = useCallback(
		(data: DataTransfer): boolean => {
			const files = getTransferFiles(data);
			if (files.length > 0) {
				void handlePastedFiles(files);
				return true;
			}
			if (!autoConvertLong) {
				return false;
			}
			const text = data.getData('text/plain');
			if (text.length < PASTE_ATTACHMENT_THRESHOLD) {
				return false;
			}
			void handlePastedText(text);
			return true;
		},
		[autoConvertLong, handlePastedFiles, handlePastedText],
	);

	/**
	 * Claims files dropped onto the composer, saving them like a paste.
	 * @param data - The drag payload
	 * @returns True when the drop carried files and was taken over
	 */
	const consumeDroppedTransfer = useCallback(
		(data: DataTransfer): boolean => {
			const files = getTransferFiles(data);
			if (files.length === 0) {
				return false;
			}
			void handlePastedFiles(files);
			return true;
		},
		[handlePastedFiles],
	);

	const handleDrop = useCallback(
		(event: ReactDragEvent<HTMLElement>) => {
			if (consumeDroppedTransfer(event.dataTransfer)) {
				event.preventDefault();
			}
		},
		[consumeDroppedTransfer],
	);

	/** Signals the composer as a valid drop target so `handleDrop` can fire. */
	const handleDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
		if (Array.from(event.dataTransfer.types).includes('Files')) {
			event.preventDefault();
		}
	}, []);

	const handleFileChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const files = event.target.files ? [...event.target.files] : [];
			if (files.length > 0) {
				void handlePastedFiles(files);
			}
			event.target.value = '';
		},
		[handlePastedFiles],
	);

	const removeAttachment = useCallback(
		(id: string) => {
			setAttachmentError(null);
			editorRef.current?.removeAttachment(id);
		},
		[editorRef],
	);

	return {
		addAttachments,
		attachmentError,
		attachments,
		consumeDroppedTransfer,
		consumePastedTransfer,
		fileInputRef,
		handleAddAttachment: useCallback(() => {
			fileInputRef.current?.click();
		}, []),
		handleDragOver,
		handleDrop,
		handleFileChange,
		hasChips: attachments.length > 0,
		removeAttachment,
		setAttachmentError,
	};
}
