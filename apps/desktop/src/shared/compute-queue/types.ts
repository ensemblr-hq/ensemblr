/** Lifecycle state of one compute-queue job. */
export type ComputeJobState =
	| 'queued'
	| 'running'
	| 'succeeded'
	| 'failed'
	| 'cancelled';

/**
 * What a job runs: `command` is a headless shell command the queue spawns
 * itself, `script` is a repository setup or run script that runs in its own
 * dock terminal while holding a queue slot.
 */
export type ComputeJobKind = 'command' | 'script';

/**
 * Who asked for the job. `agent` and `auto` (a setup script the app starts on
 * its own when a workspace is created) wait for a free slot; `user` — a script
 * the human clicked — starts at once and holds a slot so agents queue behind it.
 */
export type ComputeJobInitiator = 'agent' | 'auto' | 'user';

/** One job as the queue reports it to the renderer and to agents. */
export interface ComputeJobSnapshot {
	command: string;
	/** Epoch milliseconds the job finished, failed, or was cancelled. */
	endedAt: number | null;
	/** Epoch milliseconds the job entered the queue. */
	enqueuedAt: number;
	exitCode: number | null;
	id: string;
	initiator: ComputeJobInitiator;
	kind: ComputeJobKind;
	label: string;
	/** Absolute path of the job's output log; null for script jobs, whose output lives in their terminal. */
	logPath: string | null;
	/** One-based place among queued jobs; null once the job has left the queue. */
	position: number | null;
	sessionId: string | null;
	signal: string | null;
	/** Epoch milliseconds the job was granted a slot; null while queued. */
	startedAt: number | null;
	state: ComputeJobState;
	/** Dock terminal running a script job; null for command jobs and before launch. */
	terminalId: string | null;
	workspaceId: string;
	workspaceName: string | null;
}

/** The whole queue at one moment: its settings and every live or recent job. */
export interface ComputeQueueSnapshot {
	enabled: boolean;
	/** Slots currently held, which a user-started script can push above `slots`. */
	inUse: number;
	jobs: readonly ComputeJobSnapshot[];
	slots: number;
}

/** Job states that will not change again. */
const FINISHED_STATES: ReadonlySet<ComputeJobState> = new Set([
	'succeeded',
	'failed',
	'cancelled',
]);

/**
 * Whether a job has reached a state it will not leave.
 * @param state - The job state to test.
 * @returns True for succeeded, failed, and cancelled.
 */
export function isComputeJobFinished(state: ComputeJobState): boolean {
	return FINISHED_STATES.has(state);
}
