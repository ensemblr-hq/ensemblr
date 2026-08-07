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
	attachPastedFiles,
	getTransferFiles,
} from '@/renderer/lib/workbench/composer-attachments';
import {
	composerExternalsAtomFamily,
	composerMentionsAtomFamily,
	composerUploadsAtomFamily,
	useComposerAttachmentInbox,
} from '@/renderer/state/composer';
import { autoConvertLongTextAtom } from '@/renderer/state/preferences';

/**
 * Pasted text at or above this length is converted into a `.txt` attachment
 * instead of being inlined, so a wall of pasted output does not bury the draft.
 */
const PASTE_ATTACHMENT_THRESHOLD = 5_000;

/**
 * The composer's three attachment lists and every way the user adds to or
 * removes from them: the file picker, paste (files and long-text conversion),
 * and drag-and-drop.
 *
 * Uploads are in-memory `File`s awaiting send; mentions are workspace files
 * referenced by path; externals are files copied in from outside the workspace.
 * Adds dedupe by path so re-attaching the same file is a no-op.
 * @param chatTabId - Chat tab the attachment lists are scoped to
 * @param workspaceCwd - Absolute workspace path pasted files are saved under
 * @returns The lists, their setters, the pending error, and the DOM handlers
 */
export function useComposerAttachments({
	chatTabId,
	workspaceCwd,
}: {
	chatTabId: string;
	workspaceCwd: string;
}) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [uploadAttachments, setUploadAttachments] = useAtom(
		composerUploadsAtomFamily(chatTabId),
	);
	const [mentionAttachments, setMentionAttachments] = useAtom(
		composerMentionsAtomFamily(chatTabId),
	);
	const [externalAttachments, setExternalAttachments] = useAtom(
		composerExternalsAtomFamily(chatTabId),
	);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const autoConvertLong = useAtomValue(autoConvertLongTextAtom);

	// Drain externally-pushed attachments (transcript chips, etc.) into the
	// mention list. Dedup by path so re-clicking the same chip is a no-op.
	const attachmentInbox = useComposerAttachmentInbox(chatTabId);
	useEffect(() => {
		if (attachmentInbox.pending.length === 0) {
			return;
		}
		setMentionAttachments((prev) => {
			const next = [...prev];
			for (const file of attachmentInbox.pending) {
				if (!next.some((existing) => existing.path === file.path)) {
					next.push(file);
				}
			}
			return next;
		});
		attachmentInbox.clear();
	}, [attachmentInbox, setMentionAttachments]);

	const handlePastedFiles = useCallback(
		async (files: readonly File[]) => {
			setAttachmentError(null);
			const { error, savedExternals, savedFiles } = await attachPastedFiles(
				files,
				workspaceCwd,
			);
			if (error) {
				setAttachmentError(error);
			}
			if (savedFiles.length > 0) {
				setMentionAttachments((prev) => {
					const next = [...prev];
					for (const file of savedFiles) {
						if (!next.some((existing) => existing.path === file.path)) {
							next.push(file);
						}
					}
					return next;
				});
			}
			if (savedExternals.length > 0) {
				setExternalAttachments((prev) => {
					const next = [...prev];
					for (const external of savedExternals) {
						if (
							!next.some(
								(existing) => existing.absolutePath === external.absolutePath,
							)
						) {
							next.push(external);
						}
					}
					return next;
				});
			}
		},
		[workspaceCwd, setMentionAttachments, setExternalAttachments],
	);

	/** Handles file pastes and long-text paste conversion for the textarea. */
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
			const file = new File([text], 'pasted-text.txt', { type: 'text/plain' });
			setUploadAttachments((prev) => [...prev, file]);
			setAttachmentError(null);
		},
		[autoConvertLong, handlePastedFiles, setUploadAttachments],
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
				setUploadAttachments((prev) => [...prev, ...files]);
			}
			event.target.value = '';
		},
		[setUploadAttachments],
	);

	const removeUpload = useCallback(
		(index: number) => {
			setUploadAttachments((prev) => prev.filter((_, idx) => idx !== index));
		},
		[setUploadAttachments],
	);

	const removeMention = useCallback(
		(path: string) => {
			setAttachmentError(null);
			setMentionAttachments((prev) =>
				prev.filter((entry) => entry.path !== path),
			);
		},
		[setMentionAttachments],
	);

	const removeExternal = useCallback(
		(absolutePath: string) => {
			setAttachmentError(null);
			setExternalAttachments((prev) =>
				prev.filter((entry) => entry.absolutePath !== absolutePath),
			);
		},
		[setExternalAttachments],
	);

	return {
		attachmentError,
		externalAttachments,
		fileInputRef,
		handleAddAttachment: useCallback(() => {
			fileInputRef.current?.click();
		}, []),
		handleDragOver,
		handleDrop,
		handleFileChange,
		handlePaste,
		hasChips:
			uploadAttachments.length > 0 ||
			mentionAttachments.length > 0 ||
			externalAttachments.length > 0,
		mentionAttachments,
		removeExternal,
		removeMention,
		removeUpload,
		setAttachmentError,
		setExternalAttachments,
		setMentionAttachments,
		setUploadAttachments,
		uploadAttachments,
	};
}
