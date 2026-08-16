import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { EditorState } from 'lexical';
import type { ComposerAttachment } from '@/renderer/types/workbench';

/**
 * Per-chat composer draft text, keyed by chat-tab id. Each tab owns its own
 * unsent input so typing in one tab never bleeds into another. In-memory only:
 * a draft is a transient buffer, and restoring one across a restart would put
 * text back in front of the user that they have no memory of leaving there.
 */
export const composerValueAtomFamily = atomFamily((_chatTabId: string) =>
	atom(''),
);

/**
 * Per-chat attachment list, keyed by chat-tab id. One ordered list for every
 * source — `@` mentions, uploads, and externally referenced files — so the order
 * the user added them in is the order the outgoing prompt carries.
 */
export const composerAttachmentsAtomFamily = atomFamily((_chatTabId: string) =>
	atom<readonly ComposerAttachment[]>([]),
);

/**
 * Per-chat editor document, keyed by chat-tab id. The text and attachment atoms
 * above are flat mirrors of it; this one keeps the interleaving, so a draft that
 * comes back after a tab switch still has its chips in the sentence rather than
 * bunched at the end. Holds the committed `EditorState` rather than its JSON —
 * Lexical seeds a fresh editor from one directly, so a tab switch costs no
 * serialization. In-memory only, like the rest of the draft.
 */
export const composerEditorStateAtomFamily = atomFamily((_chatTabId: string) =>
	atom<EditorState | null>(null),
);

/**
 * Whether this chat has already been handed its workspace's linked issue as an
 * attachment, keyed by chat-tab id. Lives beside the draft rather than in the
 * component because the seed must survive a remount and a route change, and
 * because removing the chip has to stick — a per-mount ref would re-attach the
 * issue the moment the user navigated away and back.
 */
export const composerLinkedIssueSeededAtomFamily = atomFamily(
	(_chatTabId: string) => atom(false),
);

/**
 * Evicts a chat's draft atoms from their families. Call only when a chat tab is
 * permanently deleted — closed-but-restorable tabs must keep their draft, matching
 * how {@link forgetChatOverrides} treats model/thinking picks. The atoms are
 * in-memory, so `atomFamily.remove` is the whole cleanup; there is no backing
 * storage key to clear.
 * @param chatTabId - Chat-tab id whose draft atoms should be dropped
 */
export function forgetComposerDraft(chatTabId: string): void {
	composerValueAtomFamily.remove(chatTabId);
	composerAttachmentsAtomFamily.remove(chatTabId);
	composerEditorStateAtomFamily.remove(chatTabId);
	composerLinkedIssueSeededAtomFamily.remove(chatTabId);
}
