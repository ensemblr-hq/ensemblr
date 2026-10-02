import { atom } from 'jotai';
import type { ConversationScrollOffset } from '@/renderer/types/chat';

/**
 * Scroll position of every conversation viewport the user has visited, keyed by
 * chat tab id. Switching tabs or workspaces unmounts the timeline, so this is
 * what lets it come back where the user left it. In-memory only: offsets belong
 * to a rendered message list, which a restart rebuilds from scratch.
 */
export const conversationScrollOffsetsAtom = atom<
	Readonly<Record<string, ConversationScrollOffset>>
>({});
