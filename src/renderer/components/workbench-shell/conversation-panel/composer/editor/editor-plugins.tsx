import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	DELETE_CHARACTER_COMMAND,
	DELETE_LINE_COMMAND,
	DELETE_WORD_COMMAND,
	DRAGOVER_COMMAND,
	DROP_COMMAND,
	type EditorState,
	type LexicalCommand,
	type LexicalNode,
	PASTE_COMMAND,
} from 'lexical';
import { type RefObject, useEffect } from 'react';

import { isReferenceAttachment } from '@/renderer/lib/workbench/composer-attachments';
import type { ComposerAttachment } from '@/renderer/types/workbench';

import {
	$createAttachmentNode,
	$isAttachmentNode,
	isTrayChip,
} from './attachment-node';
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
 * Adds a chip to the tray — the run of tray chips at the very top of the draft —
 * after the ones already there, rather than at the caret. The tray reads as one
 * row above the typed text, so a chip attached later belongs at the end of it
 * rather than in the middle of whatever sentence the caret sits in. Must run
 * inside an editor update.
 * @param attachment - The attachment the chip stands for
 */
function $insertTrayChip(attachment: ComposerAttachment): void {
	const root = $getRoot();
	let index = 0;
	for (const child of root.getChildren()) {
		if (!($isAttachmentNode(child) && isTrayChip(child.getAttachment()))) {
			break;
		}
		index += 1;
	}
	root.splice(index, 0, [$createAttachmentNode(attachment)]);
}

/**
 * Every command Lexical funnels a backward delete into, whichever chord or
 * input event started it. Each carries `true` for backward and `false` for
 * forward, so a handler registered here answers for both directions.
 */
const BACKWARD_DELETE_COMMANDS: readonly LexicalCommand<boolean>[] = [
	DELETE_CHARACTER_COMMAND,
	DELETE_LINE_COMMAND,
	DELETE_WORD_COMMAND,
];

/**
 * Whether a node is the first thing inside a block, so an offset of zero in it
 * is the block's own start rather than a position after something else.
 * @param node - The node the caret sits in
 * @param block - The top-level block the caret sits in
 * @returns True when nothing in the block precedes the node
 */
function $isFirstDescendant(node: LexicalNode, block: LexicalNode): boolean {
	let current: LexicalNode | null = node;
	while (current && current !== block) {
		if (current.getPreviousSibling() !== null) {
			return false;
		}
		current = current.getParent();
	}
	return current === block;
}

/**
 * Whether the caret sits at the very start of its block with nothing behind that
 * block but the tray. Lexical's own backward delete walks out of the block and
 * takes its previous sibling, which for the draft's first block is the last tray
 * chip — so a backward delete at the start of the sentence would silently empty
 * the tray, and one on an empty draft would delete the paragraph and leave
 * nowhere to type. Must run inside an editor read or update.
 * @returns True when a backward delete here would reach into the tray
 */
function $isCaretAgainstTray(): boolean {
	const selection = $getSelection();
	if (!($isRangeSelection(selection) && selection.isCollapsed())) {
		return false;
	}
	const { focus } = selection;
	const block = focus.getNode().getTopLevelElement();
	if (!block) {
		return false;
	}
	const behind = block.getPreviousSibling();
	if (!($isAttachmentNode(behind) && isTrayChip(behind.getAttachment()))) {
		return false;
	}
	return focus.offset === 0 && $isFirstDescendant(focus.getNode(), block);
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
 * Keeps a backward delete at the start of the draft from reaching into the
 * tray. The tray stands above the sentence rather than in it, so the chip a
 * backward delete would take is not the one the caret appears to be against —
 * and with several chips up there, which one goes is neither visible nor
 * guessable. They come off with their own control instead.
 *
 * Guarding these three commands rather than `KEY_BACKSPACE_COMMAND` is what
 * makes that hold for every way of asking. Lexical routes a bare Backspace
 * through the keystroke command, but sends ⌥⌫ and ⌃⌫ straight to
 * `DELETE_WORD_COMMAND`, ⌘⌫ to `DELETE_LINE_COMMAND`, and ⌃H and the
 * `deleteContentBackward` input event iOS and Android deliver instead of a
 * keystroke straight to `DELETE_CHARACTER_COMMAND`. Every one of those callers
 * has already called `preventDefault` on the event it came from by the time the
 * command runs, so refusing the command is the whole of the guard.
 */
export function TrayGuardPlugin() {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		const unregister = BACKWARD_DELETE_COMMANDS.map((command) =>
			editor.registerCommand(
				command,
				(isBackward) => isBackward && $isCaretAgainstTray(),
				COMMAND_PRIORITY_CRITICAL,
			),
		);
		return () => {
			for (const dispose of unregister) {
				dispose();
			}
		};
	}, [editor]);

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
				if (isTrayChip(attachment)) {
					editor.update(() => {
						if (!$isDuplicateChip(attachment)) {
							$insertTrayChip(attachment);
						}
					});
					return;
				}
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
					if (isTrayChip(attachment)) {
						selection.insertText('');
						$insertTrayChip(attachment);
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
