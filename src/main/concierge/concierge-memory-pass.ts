import type { AgentSession } from '../agent-runtime';
import type { AgentSubscription } from '../agent-runtime/agent-types.ts';

/** Prompt the memory pass submits before a clear replaces the session. */
export const MEMORY_PASS_PROMPT = `Your context is about to be cleared. Before it is, write what this conversation established into your memory directory — one file per durable fact, and refresh MEMORY.md so the next session can find them. Record decisions, project state, and anything you would otherwise have to rediscover. Do not summarise the conversation back to me; write the files.`;

/**
 * How long the memory pass may run before the clear proceeds without it.
 *
 * A ceiling rather than an open wait, because the clear is what the user pressed
 * and a runtime that never comes back to idle would otherwise wedge it. Losing a
 * memory pass costs one conversation's notes; losing the clear costs the panel.
 */
const MEMORY_PASS_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Runs the memory-write turn on a live Concierge session and resolves once the
 * runtime has finished it.
 *
 * Completion is the `streaming` → `idle` transition rather than any `idle`,
 * because a session sitting idle when the pass starts would otherwise report the
 * turn done before it began. Never rejects: a refused submit, a crashed runtime,
 * and a turn that outran the ceiling all resolve `false` so the caller can clear
 * regardless.
 * @param input - The live runtime session, and an override for the ceiling.
 * @returns True when the runtime completed the turn, false when it did not.
 */
export function runConciergeMemoryPass({
	session,
	timeoutMs = MEMORY_PASS_TIMEOUT_MS,
}: {
	session: AgentSession;
	timeoutMs?: number;
}): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		let submitted = false;
		let subscription: AgentSubscription | null = null;

		const finish = (wrote: boolean): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			subscription?.unsubscribe();
			resolve(wrote);
		};

		const timer = setTimeout(() => finish(false), timeoutMs);

		// Subscribing flushes whatever the session buffered before anyone was
		// listening, so nothing counts as this turn's outcome until it is sent.
		subscription = session.subscribe((event) => {
			if (!submitted) {
				return;
			}
			if (event.type === 'shutdown') {
				finish(false);
				return;
			}
			if (event.type !== 'status') {
				return;
			}
			if (event.status === 'errored' || event.status === 'closed') {
				finish(false);
				return;
			}
			if (event.previous === 'streaming' && event.status === 'idle') {
				finish(true);
			}
		});

		if (settled) {
			subscription.unsubscribe();
			return;
		}

		submitted = true;
		session.submit({ prompt: MEMORY_PASS_PROMPT }).catch(() => finish(false));
	});
}
