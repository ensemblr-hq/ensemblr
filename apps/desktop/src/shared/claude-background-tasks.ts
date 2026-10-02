import type {
	AgentBackgroundTaskWire,
	AgentPersistedEnvelope,
} from './ipc/contracts/agent-session.ts';

/**
 * The background tasks a session's runtime currently reports as live: work that
 * outlives the turn that started it — a backgrounded shell command, an async
 * subagent.
 *
 * The runtime emits the whole set on every membership change rather than
 * start/stop edges, and this projection swaps its set for each payload. That is
 * the runtime's own instruction and it is the point: pairing edges means one
 * dropped frame wedges a running indicator that never clears, which is worse
 * than no indicator at all because the user learns to ignore it.
 */
export interface ClaudeBackgroundTaskState {
	tasks: readonly AgentBackgroundTaskWire[];
}

const NO_TASKS: ClaudeBackgroundTaskState = { tasks: [] };

/**
 * Creates an empty background-task projection.
 * @returns A fresh state with no live tasks.
 */
export function createClaudeBackgroundTaskState(): ClaudeBackgroundTaskState {
	return NO_TASKS;
}

/**
 * Folds one persisted envelope into the background-task projection.
 *
 * Only three things move it: the runtime's own level signal, which replaces the
 * set outright; a session starting, which empties it because the set is per
 * runtime process and a fresh process is seeded with nothing; and a session
 * ending, for the same reason.
 * @param state - Current projection.
 * @param envelope - Normalized persisted event to apply.
 * @returns The original state for irrelevant events, otherwise the updated projection.
 */
export function reduceClaudeBackgroundTasks(
	state: ClaudeBackgroundTaskState,
	envelope: AgentPersistedEnvelope,
): ClaudeBackgroundTaskState {
	if (envelope.kind === 'background-tasks') {
		return sameTasks(state.tasks, envelope.tasks)
			? state
			: { tasks: envelope.tasks };
	}
	if (envelope.kind === 'shutdown') {
		return clear(state);
	}
	if (envelope.kind === 'status') {
		const endsProcess =
			envelope.status === 'starting' ||
			envelope.status === 'closed' ||
			envelope.status === 'errored';
		return endsProcess ? clear(state) : state;
	}
	return state;
}

/**
 * Counts the tasks that should light an activity indicator, which excludes the
 * housekeeping the runtime flags as ambient.
 * @param state - Current projection.
 * @returns The number of tasks worth reporting as activity.
 */
export function countActiveBackgroundTasks(
	state: ClaudeBackgroundTaskState,
): number {
	return state.tasks.reduce(
		(total, task) => (task.ambient === true ? total : total + 1),
		0,
	);
}

/**
 * Lists the tasks that should light an activity indicator, in the order the
 * runtime reported them.
 * @param state - Current projection.
 * @returns The non-ambient tasks.
 */
export function activeBackgroundTasks(
	state: ClaudeBackgroundTaskState,
): readonly AgentBackgroundTaskWire[] {
	return state.tasks.filter((task) => task.ambient !== true);
}

/**
 * Empties the projection, preserving object identity when it is already empty
 * so an event that moves nothing re-renders nobody.
 * @param state - Current projection.
 * @returns The emptied projection, or the same reference when already empty.
 */
function clear(state: ClaudeBackgroundTaskState): ClaudeBackgroundTaskState {
	return state.tasks.length === 0 ? state : NO_TASKS;
}

/**
 * Whether two reported sets describe the same tasks in the same state. The
 * runtime re-emits the level on any membership change and on an `ambient` flip,
 * so comparing rather than assigning keeps an unchanged re-emit from
 * re-rendering every consumer.
 * @param current - The set the projection holds.
 * @param next - The set the runtime just reported.
 * @returns True when nothing the consumers read has moved.
 */
function sameTasks(
	current: readonly AgentBackgroundTaskWire[],
	next: readonly AgentBackgroundTaskWire[],
): boolean {
	if (current.length !== next.length) {
		return false;
	}
	return current.every((task, index) => {
		const other = next[index];
		return (
			other !== undefined &&
			task.taskId === other.taskId &&
			task.description === other.description &&
			task.taskType === other.taskType &&
			task.ambient === other.ambient
		);
	});
}
