import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type {
	ExternalAttachment,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';

/**
 * Per-chat composer draft text, keyed by chat-tab id. Each tab owns its own
 * unsent input so typing in one tab never bleeds into another. In-memory only:
 * drafts are intentionally not persisted, since the sibling attachment families
 * hold non-serializable `File` objects and the draft is a transient buffer.
 */
export const composerValueAtomFamily = atomFamily((_chatTabId: string) =>
	atom(''),
);

/**
 * Per-chat uploaded-file attachments (paperclip / paste / drop), keyed by
 * chat-tab id. Holds live `File` objects, so this is in-memory only.
 */
export const composerUploadsAtomFamily = atomFamily((_chatTabId: string) =>
	atom<readonly File[]>([]),
);

/**
 * Per-chat `@`-mention file chips, keyed by chat-tab id. Scoped alongside the
 * draft text so a tab's mentions travel with its draft.
 */
export const composerMentionsAtomFamily = atomFamily((_chatTabId: string) =>
	atom<readonly WorkspaceFileSummary[]>([]),
);

/**
 * Per-chat external (path-referenced) attachment chips, keyed by chat-tab id.
 */
export const composerExternalsAtomFamily = atomFamily((_chatTabId: string) =>
	atom<readonly ExternalAttachment[]>([]),
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
	composerUploadsAtomFamily.remove(chatTabId);
	composerMentionsAtomFamily.remove(chatTabId);
	composerExternalsAtomFamily.remove(chatTabId);
}
