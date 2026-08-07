import type { UIMessage } from 'ai';

import { skillInvocationKey } from '@/renderer/lib/pi';
import type { OptimisticPrompt } from '@/renderer/state/composer';

/**
 * Convert an optimistic prompt entry into a renderable user UIMessage.
 * @param entry - The optimistic prompt awaiting persistence.
 * @returns The equivalent user-role UIMessage.
 */
export function optimisticToUIMessage(entry: OptimisticPrompt): UIMessage {
	return {
		id: entry.id,
		parts: [{ state: 'done', text: entry.prompt, type: 'text' }],
		role: 'user',
	};
}

/**
 * Returns the optimistic-prompt entries that have not yet been mirrored by a
 * persisted user message. Matches on the normalized dedup key rather than the
 * raw text, so a skill prompt reconciles with the `<skill>` block Pi expanded it
 * into, and consumes one persisted message per match so duplicates resolve in
 * submission order.
 * @param optimistic - Prompts submitted locally and not yet reconciled
 * @param persisted - The persisted messages to match against
 * @returns The optimistic entries still awaiting a persisted counterpart
 */
export function filterUnmatchedOptimistic(
	optimistic: readonly OptimisticPrompt[],
	persisted: readonly UIMessage[],
): readonly OptimisticPrompt[] {
	if (optimistic.length === 0) {
		return optimistic;
	}
	const remainingByKey = buildPersistedKeyCounts(persisted);
	const unmatched: OptimisticPrompt[] = [];
	for (const entry of optimistic) {
		const key = promptDedupKey(entry.prompt);
		const remaining = remainingByKey.get(key) ?? 0;
		if (remaining === 0) {
			unmatched.push(entry);
			continue;
		}
		remainingByKey.set(key, remaining - 1);
	}
	return unmatched;
}

/**
 * Find the optimistic prompts that a persisted user message now mirrors.
 * @param optimistic - The pending optimistic prompts.
 * @param persisted - The persisted messages to match against.
 * @returns The ids of optimistic prompts that have a persisted match.
 */
export function matchOptimisticAgainstMessages(
	optimistic: readonly OptimisticPrompt[],
	persisted: readonly UIMessage[],
): string[] {
	const remainingByKey = buildPersistedKeyCounts(persisted);
	const matched: string[] = [];
	for (const entry of optimistic) {
		const key = promptDedupKey(entry.prompt);
		const remaining = remainingByKey.get(key) ?? 0;
		if (remaining === 0) {
			continue;
		}
		remainingByKey.set(key, remaining - 1);
		matched.push(entry.id);
	}
	return matched;
}

/**
 * Canonicalizes a prompt to the key used to match optimistic prompts against
 * persisted ones. A `/skill:name` invocation and the `<skill>…</skill>` block
 * Pi expands it into share one key; every other prompt keys on its raw text, so
 * a skill prompt reconciles with its persisted expansion instead of lingering
 * as a duplicate bubble.
 * @param text - The prompt text, optimistic or persisted
 * @returns The dedup key for the prompt
 */
function promptDedupKey(text: string): string {
	return skillInvocationKey(text) ?? text;
}

/**
 * Counts persisted user-message dedup keys so duplicates are consumed in
 * submission order without repeated linear scans.
 * @param messages - The persisted messages to tally
 * @returns How many persisted messages carry each dedup key
 */
function buildPersistedKeyCounts(
	messages: readonly UIMessage[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const key of collectPersistedUserKeys(messages)) {
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

/**
 * Collect the dedup key of each persisted user message, canonicalizing skill
 * expansions so they match the `/skill:name` prompt that produced them.
 * @param messages - The persisted messages to scan.
 * @returns The dedup key of every non-empty user message, in order.
 */
function collectPersistedUserKeys(messages: readonly UIMessage[]): string[] {
	const keys: string[] = [];
	for (const message of messages) {
		if (message.role !== 'user') {
			continue;
		}
		const joined = message.parts
			.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
			.join('\n');
		if (joined.length > 0) {
			keys.push(promptDedupKey(joined));
		}
	}
	return keys;
}
