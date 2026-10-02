/** Which chat, in which workspace, a boundary belongs to. */
interface BoundaryScope {
	agentSessionId: string;
	workspaceId: string;
}

/** What {@link createBoundaryQueue} hands back. */
interface BoundaryQueue {
	/** Resolves once nothing is queued in any workspace. */
	drain: () => Promise<void>;
	/**
	 * Resolves once the chat's last boundary queued so far has settled, and never
	 * rejects. Boundaries queued after the call, and other chats' boundaries
	 * queued behind that one, are not waited on.
	 */
	flushSession: (agentSessionId: string) => Promise<void>;
	/** Queues a task behind everything already queued in the scope's workspace; resolves to its result. */
	run: <T>(scope: BoundaryScope, task: () => Promise<T>) => Promise<T>;
}

/**
 * Drops a settled task's entry, unless a later task has already replaced it.
 * @param tails - The map holding each key's latest task
 * @param key - The key whose task just settled
 * @param settled - The settled promise that was stored for it
 */
function forgetSettled(
	tails: Map<string, Promise<void>>,
	key: string,
	settled: Promise<void>,
): void {
	if (tails.get(key) === settled) {
		tails.delete(key);
	}
}

/**
 * Runs each workspace's turn boundaries one at a time, in the order they were
 * queued, while different workspaces proceed independently.
 *
 * A boundary captures the worktree through `git add -A` and rewrites private
 * refs, so two chats of one workspace ending turns together would each stage the
 * whole tree at once. Keying by workspace rather than by chat is what stops that;
 * a chat belongs to one workspace, so its boundaries still run in queue order.
 * A task that fails does not stall the ones behind it — its own caller sees the
 * rejection, and nobody else does.
 * @returns The queue's `run`, `flushSession`, and `drain`
 */
export function createBoundaryQueue(): BoundaryQueue {
	const workspaceTails = new Map<string, Promise<void>>();
	const sessionTails = new Map<string, Promise<void>>();

	return {
		drain: async () => {
			while (workspaceTails.size > 0) {
				await Promise.all(workspaceTails.values());
			}
		},
		flushSession: async (agentSessionId) => {
			await sessionTails.get(agentSessionId);
		},
		run: ({ agentSessionId, workspaceId }, task) => {
			const result = (
				workspaceTails.get(workspaceId) ?? Promise.resolve()
			).then(task);
			const settled = result.then(
				() => undefined,
				() => undefined,
			);
			workspaceTails.set(workspaceId, settled);
			sessionTails.set(agentSessionId, settled);
			void settled.then(() => {
				forgetSettled(workspaceTails, workspaceId, settled);
				forgetSettled(sessionTails, agentSessionId, settled);
			});

			return result;
		},
	};
}
