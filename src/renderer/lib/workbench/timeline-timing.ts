import type { UIMessage } from 'ai';

import { turnMetadataOf } from '@/renderer/lib/pi';
import type { OptimisticPrompt } from '@/renderer/state/composer';

/**
 * Resolves the submit instant (ms) that anchors the live "Working…" indicator
 * while a turn is in flight but before the first assistant event lands. Prefers
 * the trailing persisted user message's `firstEventAt` — the exact value the
 * streaming assistant turn later uses as its `promptAt` — so the elapsed value
 * stays continuous across the pending → streaming handoff. Falls back to the
 * most recent optimistic prompt's `submittedAt` for the brief window before the
 * user prompt is persisted. Returns null when no usable timestamp exists.
 */
export function resolveLiveTurnStartMs(
	messages: readonly UIMessage[],
	optimisticPrompts: readonly OptimisticPrompt[],
): number | null {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== 'user') {
			continue;
		}
		const metadata = turnMetadataOf(message);
		if (metadata) {
			const ms = Date.parse(metadata.firstEventAt);
			if (!Number.isNaN(ms)) {
				return ms;
			}
		}
		break;
	}
	const lastOptimistic = optimisticPrompts.at(-1);
	if (lastOptimistic) {
		const ms = Date.parse(lastOptimistic.submittedAt);
		if (!Number.isNaN(ms)) {
			return ms;
		}
	}
	return null;
}
