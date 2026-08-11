import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	type EditorState,
} from 'lexical';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

import { cn } from '@/renderer/lib/utils';
import type { ComposerAttachment } from '@/renderer/types/workbench';

import { $createAttachmentNode, AttachmentNode } from './attachment-node';
import {
	DraftChangePlugin,
	EditableStatePlugin,
	EditorHandlePlugin,
	TransferPlugin,
} from './editor-plugins';
import type { ComposerDraftChange, ComposerEditorHandle } from './types';

/** Namespace Lexical tags this editor's state and events with. */
const EDITOR_NAMESPACE = 'ensemblr-composer';

/** What the draft is seeded with when there is no snapshot to restore. */
interface ComposerEditorSeed {
	attachments: readonly ComposerAttachment[];
	text: string;
}

/**
 * Builds the editor's opening document: a restored snapshot when the composer
 * is remounting onto a draft it already had, otherwise the text and chips other
 * surfaces queued for it while it was unmounted.
 * @param seed - Text and chips to open with
 * @param snapshot - A previous draft to restore instead
 * @returns The initial state LexicalComposer accepts
 */
function buildInitialEditorState(
	seed: ComposerEditorSeed,
	snapshot: EditorState | null,
): EditorState | (() => void) {
	if (snapshot) {
		return snapshot;
	}
	return () => {
		const root = $getRoot();
		root.clear();
		const paragraph = $createParagraphNode();
		if (seed.text.length > 0) {
			paragraph.append($createTextNode(seed.text));
		}
		for (const attachment of seed.attachments) {
			paragraph.append($createAttachmentNode(attachment));
		}
		root.append(paragraph);
	};
}

/**
 * The composer's editable surface: plain text with attachment chips living
 * inline in it, at the position the user put them. Replaces the textarea the
 * composer used to hold, which could only stack chips above the sentence.
 *
 * Everything outside this folder talks to it through `handleRef`, and reads the
 * draft back through `onDraftChange` as plain text plus an ordered chip list —
 * so the autocomplete engine and the send pipeline never learn about Lexical.
 */
export function ComposerEditor({
	ariaLabel,
	className,
	disabled,
	handleRef,
	initialSeed,
	initialSnapshot,
	onBlur,
	onDraftChange,
	onDroppedTransfer,
	onFocus,
	onKeyDown,
	onPastedTransfer,
	placeholder,
}: {
	ariaLabel: string;
	className?: string;
	disabled: boolean;
	handleRef: RefObject<ComposerEditorHandle | null>;
	initialSeed: ComposerEditorSeed;
	initialSnapshot: EditorState | null;
	onBlur: () => void;
	onDraftChange: (change: ComposerDraftChange) => void;
	onDroppedTransfer: (data: DataTransfer) => boolean;
	onFocus: () => void;
	onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
	onPastedTransfer: (data: DataTransfer) => boolean;
	placeholder: string;
}) {
	return (
		<LexicalComposer
			initialConfig={{
				editable: !disabled,
				editorState: buildInitialEditorState(initialSeed, initialSnapshot),
				namespace: EDITOR_NAMESPACE,
				nodes: [AttachmentNode],
				onError: (error: Error) => {
					throw error;
				},
				theme: {
					paragraph: 'm-0',
				},
			}}
		>
			<PlainTextPlugin
				ErrorBoundary={LexicalErrorBoundary}
				contentEditable={
					<ContentEditable
						aria-label={ariaLabel}
						aria-placeholder={placeholder}
						className={cn(
							'sleek-scrollbar max-h-64 min-h-28 w-full overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed outline-none',
							disabled && 'cursor-not-allowed opacity-50',
							className,
						)}
						onBlur={onBlur}
						onFocus={onFocus}
						onKeyDownCapture={(event) => {
							onKeyDown(event);
							if (event.defaultPrevented) {
								event.stopPropagation();
							}
						}}
						placeholder={
							<span className='pointer-events-none absolute top-0 left-0 select-none text-muted-foreground/70 text-sm leading-relaxed'>
								{placeholder}
							</span>
						}
					/>
				}
			/>
			<HistoryPlugin />
			<EditableStatePlugin editable={!disabled} />
			<DraftChangePlugin onChange={onDraftChange} />
			<TransferPlugin
				onDroppedTransfer={onDroppedTransfer}
				onPastedTransfer={onPastedTransfer}
			/>
			<EditorHandlePlugin handleRef={handleRef} />
		</LexicalComposer>
	);
}
