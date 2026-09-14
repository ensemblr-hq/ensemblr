import type {
	AgentPersistedEnvelope,
	AgentWireMessagePart,
	AgentWireMessagePayload,
} from './ipc/contracts/agent-session.ts';

/**
 * The set of Claude Code background-task ids the runtime is still tracking as
 * live for one agent session. A task lands here on the tool-result that
 * announces its launch (Bash `run_in_background`, or Agent `async_launched`),
 * and leaves on the tool-result that stops it (`TaskStop` / `KillShell` /
 * `KillBash`), on a `TaskOutput` / `BashOutput` reporting a terminal status,
 * and on session teardown.
 */
export interface ClaudeBackgroundTaskState {
	liveTaskIds: ReadonlySet<string>;
}

/**
 * Creates an empty background-task projection.
 * @returns A fresh state with no live tasks.
 */
export function createClaudeBackgroundTaskState(): ClaudeBackgroundTaskState {
	return { liveTaskIds: new Set() };
}

/**
 * Folds one persisted envelope into the background-task projection.
 *
 * The reducer is pure: a resumed session replays its event log from ordinal
 * zero and the final state matches whatever tasks are actually still live.
 * That is why the launch signal is the tool-result rather than the tool-call —
 * the tool-call cannot yet know the id the CLI assigned.
 * @param state - Current live-task projection.
 * @param envelope - Normalized persisted event to apply.
 * @returns The original state for irrelevant events, otherwise the updated projection.
 */
export function reduceClaudeBackgroundTasks(
	state: ClaudeBackgroundTaskState,
	envelope: AgentPersistedEnvelope,
): ClaudeBackgroundTaskState {
	if (envelope.kind === 'shutdown') {
		return state.liveTaskIds.size === 0 ? state : { liveTaskIds: new Set() };
	}
	if (envelope.kind === 'status') {
		if (envelope.status === 'closed' || envelope.status === 'errored') {
			return state.liveTaskIds.size === 0 ? state : { liveTaskIds: new Set() };
		}
		return state;
	}
	if (envelope.kind !== 'message') {
		return state;
	}
	return reduceMessagePayload(state, envelope.payload);
}

/**
 * Applies one message payload to the live-task set, walking the parts of a
 * whole-message envelope in order.
 * @param state - Current projection.
 * @param payload - Normalized message payload to apply.
 * @returns The projection after this payload.
 */
function reduceMessagePayload(
	state: ClaudeBackgroundTaskState,
	payload: AgentWireMessagePayload,
): ClaudeBackgroundTaskState {
	if (payload.kind === 'tool-result') {
		return applyToolResult(state, {
			output: payload.output,
			toolCallId: payload.toolCallId,
			isError: payload.isError,
		});
	}
	if (payload.kind !== 'message') {
		return state;
	}
	let next = state;
	for (const part of payload.parts) {
		if (part.kind === 'tool-result') {
			next = applyToolResult(next, {
				output: part.output,
				toolCallId: part.toolCallId,
				isError: part.isError,
			});
		}
	}
	return next;
}

/**
 * Applies one tool-result event to the projection, adding a launched task or
 * removing a stopped one. Reads the launch's id from the result's structured
 * details bag first, then falls back to a text parse for older events that
 * predate the extended `toolResultDetails` projection.
 * @param state - Current projection.
 * @param result - Tool-result to interpret.
 * @returns The projection after this result.
 */
function applyToolResult(
	state: ClaudeBackgroundTaskState,
	result: {
		output: unknown;
		toolCallId: string;
		isError: boolean;
	},
): ClaudeBackgroundTaskState {
	if (result.isError) {
		return state;
	}
	const details = readDetails(result.output);
	const text = readOutputText(result.output);
	const stoppedId = readStoppedTaskId(details);
	if (stoppedId !== null) {
		return removeTask(state, stoppedId);
	}
	const terminalTaskId = readTerminalPollId(details);
	if (terminalTaskId !== null) {
		return removeTask(state, terminalTaskId);
	}
	const launchedId = readLaunchedTaskId(details) ?? parseLaunchIdFromText(text);
	if (launchedId !== null) {
		return addTask(state, launchedId);
	}
	return state;
}

/**
 * Reads a `TaskStop` / `KillShell` result's target id from the details bag.
 * The stop verb sends its id as `taskId` (through `shell_id` as a legacy
 * alias), and the projection removes whichever the result carries.
 * @param details - Details bag on the result, or null when absent.
 * @returns The task id the stop targeted, or null when the result was not one.
 */
function readStoppedTaskId(
	details: Readonly<Record<string, unknown>> | null,
): string | null {
	if (details === null) {
		return null;
	}
	const stopped = details.stopped === true;
	if (!stopped) {
		return null;
	}
	return readString(details.taskId);
}

/**
 * Reads the polled id from a `TaskOutput` / `BashOutput` result when the
 * status word says the task is no longer running. `status` values reported by
 * the CLI are compared case-insensitively so `Completed`, `killed`, or
 * `interrupted` all clear the projection.
 * @param details - Details bag on the result, or null when absent.
 * @returns The task id whose poll reported a terminal state, or null.
 */
function readTerminalPollId(
	details: Readonly<Record<string, unknown>> | null,
): string | null {
	if (details === null) {
		return null;
	}
	const status = readString(details.status)?.toLowerCase() ?? null;
	const interrupted = details.interrupted === true;
	const terminal =
		status === 'completed' ||
		status === 'killed' ||
		status === 'errored' ||
		status === 'failed' ||
		interrupted;
	if (!terminal) {
		return null;
	}
	return readString(details.taskId);
}

/**
 * Reads the launched id from a Bash background-launch result, or from an Agent
 * `async_launched` result, whichever the details bag reports.
 * @param details - Details bag on the result, or null when absent.
 * @returns The launched task id, or null when the result was not a launch.
 */
function readLaunchedTaskId(
	details: Readonly<Record<string, unknown>> | null,
): string | null {
	if (details === null) {
		return null;
	}
	const backgroundTaskId = readString(details.backgroundTaskId);
	if (backgroundTaskId !== null) {
		return backgroundTaskId;
	}
	if (details.isAsync === true) {
		return readString(details.agentId);
	}
	return null;
}

/**
 * Parses a launch id out of a tool-result's prose. Defense-in-depth against
 * older persisted events that predate the details projection: the SDK
 * currently answers with "Command running in the background… (ID: bash_1234)"
 * or a comparable "task ID: …" line.
 * @param text - Result text as flattened for the timeline.
 * @returns The parsed task id, or null when the text carries none.
 */
function parseLaunchIdFromText(text: string): string | null {
	if (text.length === 0) {
		return null;
	}
	const match = text.match(/(?:shell|task|background task)\s*id:?\s*([\w-]+)/i);
	return match?.[1] ?? null;
}

/**
 * Adds one live task id, returning the same state when the id was already tracked.
 * @param state - Current projection.
 * @param taskId - Task id to add.
 * @returns The projection after the add.
 */
function addTask(
	state: ClaudeBackgroundTaskState,
	taskId: string,
): ClaudeBackgroundTaskState {
	if (state.liveTaskIds.has(taskId)) {
		return state;
	}
	const next = new Set(state.liveTaskIds);
	next.add(taskId);
	return { liveTaskIds: next };
}

/**
 * Removes one live task id, returning the same state when the id was not tracked.
 * @param state - Current projection.
 * @param taskId - Task id to remove.
 * @returns The projection after the remove.
 */
function removeTask(
	state: ClaudeBackgroundTaskState,
	taskId: string,
): ClaudeBackgroundTaskState {
	if (!state.liveTaskIds.has(taskId)) {
		return state;
	}
	const next = new Set(state.liveTaskIds);
	next.delete(taskId);
	return { liveTaskIds: next };
}

/**
 * Reads the details bag off a wire tool-result envelope.
 * @param output - Raw output value from the wire.
 * @returns The details record, or null when the envelope carries none.
 */
function readDetails(
	output: unknown,
): Readonly<Record<string, unknown>> | null {
	if (!isRecord(output)) {
		return null;
	}
	return isRecord(output.details) ? output.details : null;
}

/**
 * Reads the text a tool-result envelope carries, joining a Pi-style content
 * array or returning a bare string as-is.
 * @param output - Raw output value from the wire.
 * @returns The result text, or an empty string when none is present.
 */
function readOutputText(output: unknown): string {
	if (typeof output === 'string') {
		return output;
	}
	if (!isRecord(output)) {
		return '';
	}
	if (typeof output.text === 'string') {
		return output.text;
	}
	if (!Array.isArray(output.content)) {
		return '';
	}
	return output.content
		.map((block) =>
			isRecord(block) && typeof block.text === 'string' ? block.text : '',
		)
		.filter((text) => text.length > 0)
		.join('\n');
}

/**
 * Reads a value as a non-empty string, rejecting anything else.
 * @param value - Value to test.
 * @returns The string when non-empty, else null.
 */
function readString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Narrows a value to a plain (non-array) object.
 * @param value - Candidate value.
 * @returns True when `value` is a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Re-exports so the wire message types stay reachable through this barrel for
// downstream imports that already depend on the reducer.
export type { AgentWireMessagePart, AgentWireMessagePayload };
