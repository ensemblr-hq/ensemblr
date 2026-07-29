import { useStore } from 'jotai';
import { useMemo } from 'react';
import type { ConversationScrollOffset } from '@/renderer/types/chat';
import { conversationScrollOffsetsAtom } from './atoms';

/** Cap on remembered viewports, so a long session cannot grow the map without end. */
const MAX_REMEMBERED_CONVERSATIONS = 100;

/**
 * Imperative read/write access to the remembered conversation scroll offsets.
 * `forget` exists so a closed tab stops competing for the eviction cap with the
 * tabs the user still has open.
 */
export interface ConversationScrollOffsets {
	forget: (scrollKey: string) => void;
	read: (scrollKey: string) => ConversationScrollOffset | null;
	remember: (scrollKey: string, offset: ConversationScrollOffset) => void;
}

/**
 * Read and write remembered conversation scroll offsets without subscribing to
 * them. A subscription would re-render the whole timeline on every scroll tick,
 * and no component renders from these values — only the viewport DOM consumes
 * them, once, on mount.
 * @returns Accessors for the remembered offsets.
 */
export function useConversationScrollOffsets(): ConversationScrollOffsets {
	const store = useStore();

	return useMemo(
		() => ({
			forget: (scrollKey: string) => {
				store.set(
					conversationScrollOffsetsAtom,
					withoutRememberedOffset(
						store.get(conversationScrollOffsetsAtom),
						scrollKey,
					),
				);
			},
			read: (scrollKey: string) =>
				store.get(conversationScrollOffsetsAtom)[scrollKey] ?? null,
			remember: (scrollKey: string, offset: ConversationScrollOffset) => {
				store.set(
					conversationScrollOffsetsAtom,
					withRememberedOffset(
						store.get(conversationScrollOffsetsAtom),
						scrollKey,
						offset,
					),
				);
			},
		}),
		[store],
	);
}

/**
 * Add one offset to the remembered map, evicting the longest-known other entry
 * once the cap is reached.
 * @param offsets - The currently remembered offsets
 * @param scrollKey - Chat tab id the offset belongs to
 * @param offset - Position to remember for that tab
 * @returns A new map containing the offset, capped in size.
 */
function withRememberedOffset(
	offsets: Readonly<Record<string, ConversationScrollOffset>>,
	scrollKey: string,
	offset: ConversationScrollOffset,
): Record<string, ConversationScrollOffset> {
	const next = { ...offsets, [scrollKey]: offset };
	const keys = Object.keys(next);
	if (keys.length <= MAX_REMEMBERED_CONVERSATIONS) {
		return next;
	}
	const evicted = keys.find((key) => key !== scrollKey);
	if (evicted === undefined) {
		return next;
	}
	return Object.fromEntries(
		Object.entries(next).filter(([key]) => key !== evicted),
	);
}

/**
 * Drop one conversation from the remembered map.
 * @param offsets - The currently remembered offsets
 * @param scrollKey - Chat tab id to forget
 * @returns A new map without that entry.
 */
function withoutRememberedOffset(
	offsets: Readonly<Record<string, ConversationScrollOffset>>,
	scrollKey: string,
): Record<string, ConversationScrollOffset> {
	return Object.fromEntries(
		Object.entries(offsets).filter(([key]) => key !== scrollKey),
	);
}
