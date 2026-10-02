import type { AgentSession } from '../agent-runtime';
import type { AgentSubscription } from '../agent-runtime/agent-types.ts';

/**
 * Prompt the memory pass submits into the conversation a clear has retired.
 *
 * Written in the past tense on purpose: by the time this lands the user is
 * already typing into a fresh conversation and will never open this transcript
 * again, so the turn has to read as a file-writing job rather than as a last word
 * to the person who pressed the button.
 */
export const MEMORY_PASS_PROMPT = `This conversation has been retired. The user has already moved on to a fresh one and will never read another word you write here, so this turn exists only to write files. Put what this conversation established into your memory directory — one file per durable fact, and refresh MEMORY.md so the next session can find them.

Apply the test your playbook gives you before writing each one: if a tool call, a git command, or reading one file would answer it, leave it out. Decisions and their reasoning, constraints someone told you, what the user is after, and behaviour you had to discover by running something — those are what belongs here. A roster, a path, an id, a branch list, a file layout, a count as of today: those do not.

Your control tools are narrowed for this turn: your own file writes still go through, and \`ensemblr_recall_memory\` still answers, but every other \`ensemblr_*\` op is refused. There is nobody here to act on the app for.

If this conversation established nothing that passes that test, write nothing and say so in one line. Do not summarise the conversation back to me, and do not invent a memory to have something to show for the turn.`;

/**
 * How long the memory pass may run before the retired child is closed under it.
 *
 * A ceiling rather than an open wait, because a runtime that never comes back to
 * idle would otherwise keep a child process and its control token alive for the
 * rest of the run. Nothing is waiting on this any more — the clear hands the user
 * a fresh conversation without it — so the ceiling is generous rather than tight:
 * what it costs is one conversation's notes, and a pass cut off halfway has
 * already written the files it got to.
 */
const MEMORY_PASS_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Runs the memory-write turn on a retired Concierge session and resolves once the
 * runtime has finished it.
 *
 * Completion is the `streaming` → `idle` transition rather than any `idle`,
 * because a session sitting idle when the pass starts would otherwise report the
 * turn done before it began. Never rejects: a refused submit, a crashed runtime,
 * and a turn that outran the ceiling all resolve `false`, so the caller closes
 * the child regardless of how the turn ended.
 * @param input - The retired runtime session, and an override for the ceiling.
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
