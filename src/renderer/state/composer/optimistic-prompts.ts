import { atom, useAtom, useAtomValue } from 'jotai';
import { atomFamily } from 'jotai-family';
import { useCallback, useMemo } from 'react';

/**
 * Optimistically rendered user prompt that has been submitted by the composer
 * but is not yet reflected in the persisted agent event stream. The Timeline
 * renders these as synthetic user messages and removes them once a matching
 * persisted event lands.
 */
export interface OptimisticPrompt {
	id: string;
	chatTabId: string;
	prompt: string;
	submittedAt: string;
}

/** In-memory list of optimistically rendered prompts awaiting their matching persisted agent events. */
const optimisticPromptsAtom = atom<readonly OptimisticPrompt[]>([]);

/**
 * Whether one chat tab has a prompt still awaiting its persisted twin, keyed by
 * chat-tab id. Derived rather than filtered per consumer so a surface that only
 * branches on the fact — the conversation panel choosing between the timeline
 * and the empty state — re-renders when the flag flips rather than on every
 * push and remove in every tab.
 */
const hasPendingPromptsAtomFamily = atomFamily((chatTabId: string) =>
	atom((get) =>
		get(optimisticPromptsAtom).some((entry) => entry.chatTabId === chatTabId),
	),
);

/**
 * Reads whether a chat tab has a prompt in flight, without subscribing the
 * caller to the prompts themselves.
 * @param chatTabId - Chat tab to check
 * @returns True while the tab has at least one un-retired optimistic prompt
 */
export function useHasPendingPrompts(chatTabId: string): boolean {
	return useAtomValue(hasPendingPromptsAtomFamily(chatTabId));
}

/**
 * Public hook around the optimistic-prompts atom. Exposes scoped helpers for
 * the composer (push) and the timeline (read + reconcile). Lives at the
 * renderer-state layer so both surfaces share a single source of truth.
 */
export function useOptimisticPrompts(chatTabId: string): {
	prompts: readonly OptimisticPrompt[];
	push: (prompt: string) => OptimisticPrompt;
	remove: (id: string) => void;
	removeMany: (ids: readonly string[]) => void;
} {
	const [all, setAll] = useAtom(optimisticPromptsAtom);
	const prompts = useMemo(
		() => all.filter((entry) => entry.chatTabId === chatTabId),
		[all, chatTabId],
	);
	const push = useCallback(
		(prompt: string): OptimisticPrompt => {
			const entry: OptimisticPrompt = {
				chatTabId,
				id: `optimistic:${crypto.randomUUID()}`,
				prompt,
				submittedAt: new Date().toISOString(),
			};
			setAll((prev) => [...prev, entry]);
			return entry;
		},
		[chatTabId, setAll],
	);
	const remove = useCallback(
		(id: string): void => {
			setAll((prev) => prev.filter((entry) => entry.id !== id));
		},
		[setAll],
	);
	const removeMany = useCallback(
		(ids: readonly string[]): void => {
			if (ids.length === 0) {
				return;
			}
			const dropSet = new Set(ids);
			setAll((prev) => prev.filter((entry) => !dropSet.has(entry.id)));
		},
		[setAll],
	);
	return { prompts, push, remove, removeMany };
}
