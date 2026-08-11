import { useAtom, useAtomValue } from 'jotai';
import {
	type ChangeEvent,
	type ClipboardEvent as ReactClipboardEvent,
	type DragEvent as ReactDragEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

import {
	appendAttachments,
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
 * One ordered list covers every source, so the order the user attached things in
 * is the order the outgoing prompt carries. Everything is written to the
 * workspace's content-addressed store the moment it is attached, so every chip
 * carries a real path and re-attaching the same bytes costs nothing.
 * @param chatTabId - Chat tab the attachment list is scoped to
 * @param insertPlainText - Fallback for a long paste whose write failed
 * @param workspaceCwd - Absolute workspace path pasted files are saved under
 * @returns The list, its setter, the pending error, and the DOM handlers
 */
export function useComposerAttachments({
	chatTabId,
	insertPlainText,
	workspaceCwd,
}: {
	chatTabId: string;
	insertPlainText: (text: string) => void;
	workspaceCwd: string;
}) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [attachments, setAttachments] = useAtom(
		composerAttachmentsAtomFamily(chatTabId),
	);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const autoConvertLong = useAtomValue(autoConvertLongTextAtom);

	const addAttachments = useCallback(
		(incoming: readonly ComposerAttachment[]) => {
			setAttachments((prev) => appendAttachments(prev, incoming));
		},
		[setAttachments],
	);

	// Drain externally-pushed attachments (transcript chips, plan handoff, fork).
	const attachmentInbox = useComposerAttachmentInbox(chatTabId);
	useEffect(() => {
		if (attachmentInbox.pending.length === 0) {
			return;
		}
		addAttachments(attachmentInbox.pending);
		attachmentInbox.clear();
	}, [addAttachments, attachmentInbox]);

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

	/** Handles file pastes and long-text paste conversion for the composer. */
	const handlePaste = useCallback(
		(event: ReactClipboardEvent<HTMLTextAreaElement>) => {
			const files = getTransferFiles(event.clipboardData);
			if (files.length > 0) {
				event.preventDefault();
				void handlePastedFiles(files);
				return;
			}
			if (!autoConvertLong) {
				return;
			}
			const text = event.clipboardData.getData('text/plain');
			if (text.length < PASTE_ATTACHMENT_THRESHOLD) {
				return;
			}
			event.preventDefault();
			void handlePastedText(text);
		},
		[autoConvertLong, handlePastedFiles, handlePastedText],
	);

	/** Accepts files dropped onto the composer, saving them like a paste. */
	const handleDrop = useCallback(
		(event: ReactDragEvent<HTMLElement>) => {
			const files = getTransferFiles(event.dataTransfer);
			if (files.length === 0) {
				return;
			}
			event.preventDefault();
			void handlePastedFiles(files);
		},
		[handlePastedFiles],
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
			setAttachments((prev) => prev.filter((entry) => entry.id !== id));
		},
		[setAttachments],
	);

	return {
		addAttachments,
		attachmentError,
		attachments,
		fileInputRef,
		handleAddAttachment: useCallback(() => {
			fileInputRef.current?.click();
		}, []),
		handleDragOver,
		handleDrop,
		handleFileChange,
		handlePaste,
		hasChips: attachments.length > 0,
		removeAttachment,
		setAttachmentError,
		setAttachments,
	};
}
