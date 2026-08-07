import type { UIMessage } from 'ai';
import { useEffect, useMemo } from 'react';
import {
	eventsToUIMessages,
	filterUnmatchedOptimistic,
	matchOptimisticAgainstMessages,
	optimisticToUIMessage,
} from '@/renderer/lib/agent-timeline';
import { resolveLiveTurnStartMs } from '@/renderer/lib/workbench/timeline-timing';
import { useOptimisticPrompts } from '@/renderer/state/composer';
import type { AgentSessionEventWire } from '@/shared/ipc/contracts/agent-session';

/**
 * Merge persisted timeline events with the composer's optimistic prompts into
 * the single message list the transcript renders, retiring each optimistic
 * prompt as soon as its persisted twin arrives.
 *
 * The dedup is text-only and chronologically ordered, so back-to-back identical
 * prompts still resolve in submission order.
 * @param chatTabId - Chat tab whose optimistic prompts are merged in
 * @param events - Persisted timeline events for the active session
 * @param isStreaming - Whether the active session is mid-turn
 * @returns The merged messages, the prompt count scrolling follows, and the pending-turn start time
 */
export function useTimelineMessages({
	chatTabId,
	events,
	isStreaming,
}: {
	chatTabId: string;
	events: readonly AgentSessionEventWire[];
	isStreaming: boolean;
}): {
	messages: UIMessage[];
	pendingStartMs: number | null;
	promptCount: number;
} {
	const persistedMessages = useMemo<UIMessage[]>(
		() => eventsToUIMessages(events),
		[events],
	);

	const optimistic = useOptimisticPrompts(chatTabId);

	useEffect(() => {
		if (optimistic.prompts.length === 0) {
			return;
		}
		const matchedIds = matchOptimisticAgainstMessages(
			optimistic.prompts,
			persistedMessages,
		);
		if (matchedIds.length > 0) {
			optimistic.removeMany(matchedIds);
		}
	}, [optimistic, persistedMessages]);

	const optimisticUnmatched = useMemo(
		() => filterUnmatchedOptimistic(optimistic.prompts, persistedMessages),
		[optimistic.prompts, persistedMessages],
	);

	const messages = useMemo<UIMessage[]>(
		() => [
			...persistedMessages,
			...optimisticUnmatched.map(optimisticToUIMessage),
		],
		[persistedMessages, optimisticUnmatched],
	);

	// Counts prompts rather than watching the trailing message id, which changes
	// again when an optimistic prompt is swapped for its persisted twin.
	const promptCount = useMemo(
		() => messages.filter((message) => message.role === 'user').length,
		[messages],
	);

	// Show a live "Working…" indicator in the pre-first-token gap: the turn is
	// streaming but no assistant turn exists yet (trailing message is the user
	// prompt). Anchored at the submit time so it ticks continuously into the
	// streaming turn's own timer once the first event lands.
	const pendingStartMs =
		isStreaming && messages.at(-1)?.role === 'user'
			? resolveLiveTurnStartMs(messages, optimistic.prompts)
			: null;

	return { messages, pendingStartMs, promptCount };
}
