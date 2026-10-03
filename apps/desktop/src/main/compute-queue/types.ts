import type {
	ComputeJobInitiator,
	ComputeJobSnapshot,
	ComputeQueueSnapshot,
} from '../../shared/compute-queue.ts';

/** Who submitted a job, so the queue can attribute it and cancel it with its owner. */
export interface ComputeJobOwner {
	initiator: ComputeJobInitiator;
	/** Root of the submitting agent's delegation tree; null for app and user jobs. */
	rootSessionId?: string | null;
	/** Submitting agent session; null for app and user jobs. */
	sessionId?: string | null;
	workspaceId: string;
}

/** A headless shell command to run in a workspace once a slot is free. */
export interface EnqueueCommandRequest extends ComputeJobOwner {
	command: string;
	/** Directory relative to the workspace root; must stay inside it. Defaults to the root. */
	cwd?: string;
	/** Short human label for the queue panel; defaults to the command. */
	label?: string;
}

/** A finished or in-flight job with the output an agent needs to act on it. */
export interface ComputeJobResult extends ComputeJobSnapshot {
	/** Milliseconds from start to end; null until the job ends. */
	durationMs: number | null;
	/** Characters dropped from the front of `outputTail`. */
	omittedChars: number;
	/**
	 * The last part of combined stdout/stderr, with workspace secrets redacted.
	 * A script job's output lives in its terminal, so its tail is empty unless
	 * the launch never opened one, when it says why.
	 */
	outputTail: string;
	/** Milliseconds spent queued before the job started; null while still queued. */
	waitedMs: number | null;
}

/** Why the queue refused a request outright rather than queueing it. */
export type EnqueueFailureCode = 'invalid-cwd' | 'not-found';

/** Outcome of an enqueue: the queued job, or why it was refused. */
export type EnqueueCommandOutcome =
	| { ok: true; job: ComputeJobSnapshot }
	| { code: EnqueueFailureCode; message: string; ok: false };

/** A repository script that wants a slot before it launches in its terminal. */
export interface ScriptLeaseRequest extends ComputeJobOwner {
	command: string;
	label: string;
}

/**
 * A slot claim held by a script job. The script launches only once `granted`
 * resolves to `'granted'`; it resolves to `'cancelled'` when the job is
 * cancelled before then, and the caller must not launch. Once launched, the
 * caller reports the terminal and, when the terminal exits, the outcome —
 * `release` is what frees the slot, and calling it more than once is harmless.
 * A launch that never opens a terminal frees it with `abandon` instead, whose
 * note becomes the job's output tail so the queue can say why.
 */
export interface ScriptLease {
	/** Ends a job whose launch opened no terminal: failed, or cancelled for a refusal. */
	abandon: (outcome: { failed: boolean; note: string }) => void;
	attachTerminal: (terminalId: string) => void;
	granted: Promise<'cancelled' | 'granted'>;
	jobId: string;
	release: (outcome: {
		exitCode: number | null;
		signal?: string | null;
	}) => void;
}

/** Options for {@link ComputeQueueService.waitFor}. */
export interface WaitForJobsOptions {
	signal?: AbortSignal;
	timeoutMs: number;
}

/** What a capped wait observed: the jobs that finished and the ones still going. */
export interface WaitForJobsResult {
	pending: readonly ComputeJobResult[];
	settled: readonly ComputeJobResult[];
	timedOut: boolean;
}

/** Narrows which jobs a listing returns. */
export interface ComputeJobFilter {
	rootSessionId?: string;
	sessionId?: string;
	workspaceId?: string;
}

/**
 * The app-wide queue every heavy agent command waits in. One instance serves
 * every workspace: it grants at most `concurrency` slots at a time (read live
 * from settings), round-robins across workspaces so one burst cannot starve the
 * rest, and lets a user-started script take a slot at once even over the limit.
 * Disabled in settings, it grants everything immediately.
 */
export interface ComputeQueueService {
	/** Claims a slot for a repository script; see {@link ScriptLease}. */
	acquireScriptLease: (request: ScriptLeaseRequest) => ScriptLease;
	/** Cancels a queued job, or stops a running one; false when unknown or already finished. */
	cancel: (jobId: string) => boolean;
	/** Queues a headless command; it starts when a slot is free. */
	enqueueCommand: (
		request: EnqueueCommandRequest,
	) => Promise<EnqueueCommandOutcome>;
	/**
	 * One job with its output tail, finished or not; null when unknown or expired
	 * from history. Only the most recently finished jobs keep their tail in
	 * memory; an older one answers with an empty tail and its log path.
	 */
	getJob: (jobId: string) => ComputeJobResult | null;
	/** Live and recent jobs matching the filter, oldest first. */
	listJobs: (filter?: ComputeJobFilter) => readonly ComputeJobSnapshot[];
	/** Subscribes to queue changes; returns the unsubscribe function. */
	onChange: (listener: (snapshot: ComputeQueueSnapshot) => void) => () => void;
	/**
	 * Cancels every unfinished command job a session owns, used when the session
	 * ends. Script jobs it started are left alone, queued or running: a script an
	 * agent launched outlives the agent, as it did before the queue existed.
	 */
	releaseSession: (sessionId: string) => void;
	/** Cancels every unfinished job in a workspace, used when it is archived or removed. */
	releaseWorkspace: (workspaceId: string) => void;
	/**
	 * Re-reads settings and grants whatever they now allow; main calls it after
	 * the compute-queue settings change, so a raised limit takes effect at once.
	 */
	refresh: () => void;
	/**
	 * Cancels everything and waits for in-flight launches; a second call kills
	 * running process groups and returns the first call's promise. Never throws.
	 */
	shutdown: () => Promise<void>;
	/** The queue as it stands now. */
	snapshot: () => ComputeQueueSnapshot;
	/** Waits until every named job finishes, the timeout passes, or the signal aborts. */
	waitFor: (
		jobIds: readonly string[],
		options: WaitForJobsOptions,
	) => Promise<WaitForJobsResult>;
}
