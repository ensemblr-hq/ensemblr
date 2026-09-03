import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	DRAGOVER_COMMAND,
	DROP_COMMAND,
	type EditorState,
	PASTE_COMMAND,
} from 'lexical';
import { type RefObject, useEffect } from 'react';

import { isReferenceAttachment } from '@/renderer/lib/workbench/composer-attachments';
import type { ComposerAttachment } from '@/renderer/types/workbench';

import { $createAttachmentNode } from './attachment-node';
import {
	$findAttachmentNode,
	$linearizeDraft,
	$selectDraftRange,
} from './draft-linearizer';
import type { ComposerDraftChange, ComposerEditorHandle } from './types';

/**
 * Whether the draft already holds this attachment and should refuse a second
 * chip for it. A file chip is inlined into the prompt, so a repeat only spends
 * budget on bytes the agent already has; a reference chip carries no content and
 * stands where the user put it, so naming one workspace twice in a sentence is
 * the sentence rather than a mistake. Must run inside an editor read or update.
 * @param attachment - The attachment about to be inserted.
 * @returns True when the insert should be dropped.
 */
function $isDuplicateChip(attachment: ComposerAttachment): boolean {
	return (
		!isReferenceAttachment(attachment) &&
		$findAttachmentNode(attachment.id) !== null
	);
}

/**
 * Publishes the draft on mount and on every real update: the linearized text and
 * caret the autocomplete engine reads, the runs and chips in document order, and
 * the snapshot the draft is restored from when the composer remounts.
 *
 * The mount publish is what makes a draft the editor opened with — a restored
 * snapshot, or text another surface queued while the composer was unmounted —
 * readable by the send pipeline before the user has touched it; an update
 * listener alone only ever fires after the first edit.
 */
export function DraftChangePlugin({
	onChange,
}: {
	onChange: (change: ComposerDraftChange) => void;
}) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		const publish = (editorState: EditorState) => {
			editorState.read(() => {
				onChange({ ...$linearizeDraft(), snapshot: editorState });
			});
		};
		publish(editor.getEditorState());
		return editor.registerUpdateListener(({ editorState, prevEditorState }) => {
			if (editorState !== prevEditorState) {
				publish(editorState);
			}
		});
	}, [editor, onChange]);

	return null;
}

/**
 * Keeps the editor's editable state in step with the composer's. `initialConfig`
 * is read once when the editor is created, so a composer that mounts disabled —
 * which is what a chat does while its agent session is still binding — would
 * stay read-only for the rest of its life without this.
 */
export function EditableStatePlugin({ editable }: { editable: boolean }) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		editor.setEditable(editable);
	}, [editable, editor]);

	return null;
}

/**
 * Routes pasted and dropped payloads to the attachment store instead of letting
 * Lexical inline them: a pasted image would otherwise vanish and a dropped file
 * would land as its own filename.
 */
export function TransferPlugin({
	onDroppedTransfer,
	onPastedTransfer,
}: {
	onDroppedTransfer: (data: DataTransfer) => boolean;
	onPastedTransfer: (data: DataTransfer) => boolean;
}) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		const unregisterPaste = editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				const data =
					event instanceof ClipboardEvent ? event.clipboardData : null;
				if (!data || !onPastedTransfer(data)) {
					return false;
				}
				event.preventDefault();
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
		const unregisterDragOver = editor.registerCommand(
			DRAGOVER_COMMAND,
			(event) => {
				if (!event.dataTransfer?.types.includes('Files')) {
					return false;
				}
				event.preventDefault();
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
		const unregisterDrop = editor.registerCommand(
			DROP_COMMAND,
			(event) => {
				const data = event.dataTransfer;
				if (!data || !onDroppedTransfer(data)) {
					return false;
				}
				event.preventDefault();
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
		return () => {
			unregisterPaste();
			unregisterDragOver();
			unregisterDrop();
		};
	}, [editor, onDroppedTransfer, onPastedTransfer]);

	return null;
}

/**
 * Hands the composer hooks a handle onto the editor, so every write to the
 * draft goes through one narrow surface and Lexical stays inside this folder.
 */
export function EditorHandlePlugin({
	handleRef,
}: {
	handleRef: RefObject<ComposerEditorHandle | null>;
}) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		const insertAtSelection = (build: () => void) => {
			editor.update(() => {
				if (!$isRangeSelection($getSelection())) {
					$getRoot().selectEnd();
				}
				build();
			});
		};

		handleRef.current = {
			appendText(text: string) {
				editor.update(() => {
					$getRoot().selectEnd();
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						selection.insertText(text);
					}
				});
			},
			clear() {
				editor.update(() => {
					const root = $getRoot();
					root.clear();
					root.append($createParagraphNode());
					root.selectEnd();
				});
			},
			focus() {
				editor.focus();
			},
			insertAttachment(attachment: ComposerAttachment) {
				insertAtSelection(() => {
					if ($isDuplicateChip(attachment)) {
						return;
					}
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						selection.insertNodes([$createAttachmentNode(attachment)]);
					}
				});
			},
			insertText(text: string) {
				insertAtSelection(() => {
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						selection.insertText(text);
					}
				});
			},
			removeAttachment(id: string) {
				editor.update(() => {
					$findAttachmentNode(id)?.remove();
				});
			},
			replaceRangeWithAttachment(
				start: number,
				end: number,
				attachment: ComposerAttachment,
			) {
				editor.update(() => {
					if (!$selectDraftRange(start, end)) {
						return;
					}
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) {
						return;
					}
					if ($isDuplicateChip(attachment)) {
						selection.insertText('');
						return;
					}
					selection.insertNodes([$createAttachmentNode(attachment)]);
				});
			},
			replaceRangeWithText(start: number, end: number, text: string) {
				editor.update(() => {
					if (!$selectDraftRange(start, end)) {
						return;
					}
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						selection.insertText(text);
					}
				});
			},
			restore(snapshot: EditorState) {
				editor.setEditorState(snapshot);
			},
			setText(text: string) {
				editor.update(() => {
					const root = $getRoot();
					root.clear();
					const paragraph = $createParagraphNode();
					if (text.length > 0) {
						paragraph.append($createTextNode(text));
					}
					root.append(paragraph);
					root.selectEnd();
				});
			},
		};
		return () => {
			handleRef.current = null;
		};
	}, [editor, handleRef]);

	return null;
}
