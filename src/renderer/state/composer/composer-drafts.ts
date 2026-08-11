import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
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
}
