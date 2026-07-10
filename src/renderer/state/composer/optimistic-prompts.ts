import { atom, useAtom } from 'jotai';
import { useCallback, useMemo } from 'react';

/**
 * Optimistically rendered user prompt that has been submitted by the composer
 * but is not yet reflected in the persisted Pi event stream. The Timeline
 * renders these as synthetic user messages and removes them once a matching
 * persisted event lands.
 */
export interface OptimisticPrompt {
	id: string;
	chatTabId: string;
	prompt: string;
	submittedAt: string;
}

/** In-memory list of optimistically rendered prompts awaiting their matching persisted Pi events. */
const optimisticPromptsAtom = atom<readonly OptimisticPrompt[]>([]);

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
