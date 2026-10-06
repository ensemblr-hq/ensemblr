/**
 * The compute-queue half of agent control: the three queue ops, and the two
 * gates that send a heavy shell command to them — Pi's own `bash`, asked about
 * per call through `checkPlanModeTool`, and input an agent types into an
 * Ensemblr terminal.
 *
 * Held apart from the service because none of it touches another port: it
 * validates against the queue, reports in the queue's own terms, and fits the
 * output it hands back to the payload ceiling every op answers to.
 */
import path from 'node:path';

import {
	type AgentControlErrorCode,
	type AgentControlResult,
	type CancelJobArgs,
	type CancelJobResult,
	MAX_AGENT_PAYLOAD_CHARS,
	namespaceControlToolNames,
	type QueuedJobReport,
	type RunQueuedArgs,
	type RunQueuedResult,
	type WaitForJobArgs,
	type WaitForJobResult,
	type WaitInterruption,
} from '../../shared/agent-control.ts';
import {
	classifyHeavyCommandForSettings,
	type HeavyCommandVerdict,
	heavyCommandBlockReason,
	isComputeJobFinished,
} from '../../shared/compute-queue.ts';
import type { ComputeQueueSettings } from '../../shared/config.ts';
import type { ComputeJobResult } from '../compute-queue/index.ts';
import type { Guardrails } from './guardrails.ts';
import type { JobQueuePort } from './job-queue-ports.ts';
import { fitTail } from './payload-fit.ts';
import { type AgentControlOrigin, originToolNaming } from './ports.ts';
import type { UserInterjections, WaitWatch } from './user-interjections.ts';

/** The queue ops and heavy-command gates the agent-control service composes. */
export interface JobQueueOps {
	runQueued: (
		origin: AgentControlOrigin,
		args: RunQueuedArgs,
		signal: AbortSignal | undefined,
	) => Promise<AgentControlResult<unknown>>;
	waitForJob: (
		origin: AgentControlOrigin,
		args: WaitForJobArgs,
		signal: AbortSignal | undefined,
	) => Promise<AgentControlResult<unknown>>;
	cancelJob: (
		origin: AgentControlOrigin,
		args: CancelJobArgs,
	) => AgentControlResult<unknown>;
	/** The refusal for a heavy command run in the agent's own shell, or null when it may run. */
	shellCommandRefusal: (
		origin: AgentControlOrigin,
		command: string,
	) => string | null;
	/**
	 * Admits a write into a shell terminal, or refuses it when a line it submits
	 * — together with whatever earlier writes left unsubmitted — is heavy.
	 */
	admitTerminalInput: (
		origin: AgentControlOrigin,
		terminalId: string,
		input: string,
	) => string | null;
	/** Cancels every unfinished job the session queued. */
	releaseSession: (sessionId: string) => void;
}

/** Collaborators for {@link createJobQueueOps}. */
interface JobQueueOpsOptions {
	/** The queue, or undefined when none is wired; every op is then refused. */
	port: JobQueuePort | undefined;
	guardrails: Guardrails;
	/** Ends a wait early when the user steers the agent holding it. */
	interjections: UserInterjections;
}

/** The queue tools under the names Pi and the MCP server register them as. */
const QUEUE_TOOL_NAME = 'ensemblr_run_queued';
const WAIT_TOOL_NAME = 'ensemblr_wait_for_job';

/** Told to an agent when the app was composed without a compute queue. */
const QUEUE_UNAVAILABLE =
	'The compute queue is not available in this build of Ensemblr.';

/**
 * Room left in the payload budget for what the fitting arithmetic does not
 * measure: the note attached afterwards, and `omittedChars` growing a digit or
 * two once the tails are cut.
 */
const PAYLOAD_SLACK = 2_048;

/** Unsubmitted terminal input kept per terminal; older input falls off the front. */
const MAX_PENDING_INPUT_CHARS = 16_000;

/** Interrupt and kill-line: both discard the line being typed. */
const LINE_DISCARD_KEYS: ReadonlySet<string> = new Set(['\x03', '\x15']);

/** Backspace as terminals send it. */
const ERASE_KEYS: ReadonlySet<string> = new Set(['\x7f', '\b']);

/** What submits the typed line to the shell. */
const SUBMIT_KEYS: ReadonlySet<string> = new Set(['\r', '\n']);

/**
 * Wraps a payload in a success envelope.
 * @param data - Operation payload.
 * @returns A success result.
 */
function ok<T>(data: T): AgentControlResult<T> {
	return { ok: true, data };
}

/**
 * Builds a failure envelope.
 * @param code - Stable failure code.
 * @param error - Human-readable reason.
 * @returns A failure result.
 */
function fail(
	code: AgentControlErrorCode,
	error: string,
): AgentControlResult<never> {
	return { ok: false, code, error };
}

/**
 * A job's log path as the agent can open it: relative to its workspace, or null
 * when the log lives anywhere else or there is none.
 * @param logPath - The absolute log path the queue recorded.
 * @param workspaceCwd - The caller's workspace root.
 * @returns The workspace-relative path, or null.
 */
function relativeLogPath(
	logPath: string | null,
	workspaceCwd: string,
): string | null {
	if (logPath === null || workspaceCwd === '') {
		return null;
	}
	const relative = path.relative(workspaceCwd, logPath);
	return relative === '' ||
		relative.startsWith('..') ||
		path.isAbsolute(relative)
		? null
		: relative;
}

/**
 * Projects a queue result onto the report an agent reads.
 * @param job - The queue's view of the job.
 * @param workspaceCwd - The caller's workspace root, to relativize the log.
 * @returns The agent-facing report.
 */
function toReport(
	job: ComputeJobResult,
	workspaceCwd: string,
): QueuedJobReport {
	return {
		jobId: job.id,
		kind: job.kind,
		state: job.state,
		label: job.label,
		command: job.command,
		position: job.position,
		exitCode: job.exitCode,
		signal: job.signal,
		durationMs: job.durationMs,
		waitedMs: job.waitedMs,
		outputTail: job.outputTail,
		omittedChars: job.omittedChars,
		logPath: relativeLogPath(job.logPath, workspaceCwd),
	};
}

/**
 * Shrinks the reports' output tails until the whole payload fits the ceiling,
 * cutting from the front of each. The budget is shared smallest-first, so a
 * short tail keeps all of itself and hands what it did not need to the long
 * ones rather than every tail being cut to the same length.
 * @param reports - The reports to fit, in the order they are returned.
 * @param render - Builds the payload around a set of reports, for measuring.
 * @returns The reports with their tails fitted and `omittedChars` raised by the cut.
 */
function fitReports(
	reports: readonly QueuedJobReport[],
	render: (reports: readonly QueuedJobReport[]) => unknown,
): QueuedJobReport[] {
	const bare = reports.map((report) => ({ ...report, outputTail: '' }));
	const fixed = JSON.stringify(render(bare)).length + PAYLOAD_SLACK;
	let remaining = Math.max(0, MAX_AGENT_PAYLOAD_CHARS - fixed);
	const order = reports
		.map((report, index) => ({ index, length: report.outputTail.length }))
		.sort((left, right) => left.length - right.length);
	const fitted = new Map<number, QueuedJobReport>();
	order.forEach(({ index }, rank) => {
		const report = reports[index];
		const share = Math.floor(remaining / (order.length - rank));
		const { kept, omitted } = fitTail(report.outputTail, share);
		remaining -= JSON.stringify(kept).length - 2;
		fitted.set(
			index,
			omitted === 0
				? report
				: {
						...report,
						outputTail: kept,
						omittedChars: report.omittedChars + omitted,
					},
		);
	});
	return reports.map((report, index) => fitted.get(index) ?? report);
}

/**
 * Describes where an unfinished job stands, for a note that resumes the wait.
 * @param report - The job still queued or running.
 * @returns A short clause naming its id and state.
 */
function describePending(report: QueuedJobReport): string {
	return report.state === 'queued' && report.position !== null
		? `${report.jobId} is queued at position ${report.position}`
		: `${report.jobId} is ${report.state}`;
}

/**
 * How a wait for unfinished jobs ended: none was asked for, its window
 * expired, the user sent a message, or the calling turn was interrupted.
 */
type WaitEnding = 'none' | 'expired' | 'interjected' | 'aborted';

/** The sentence a resume note opens with, for each way a wait can end. */
const WAIT_ENDING_OPENINGS: Readonly<Record<WaitEnding, string>> = {
	aborted: 'The wait stopped because this turn was interrupted. ',
	expired: 'Not a failure: the wait window expired first. ',
	interjected:
		'Not a failure: the wait stopped early because the user sent you a message, which follows this result. Answer the user first (if you already have, just resume), then come back to the jobs. ',
	none: '',
};

/**
 * Names how a wait that returned with jobs unfinished ended.
 * @param watch - The watch the wait ran under.
 * @returns `interjected` for a user message, `aborted` when the turn was interrupted, else `expired`.
 */
function waitEnding(watch: WaitWatch): WaitEnding {
	if (watch.interjected()) {
		return 'interjected';
	}
	return watch.signal.aborted ? 'aborted' : 'expired';
}

/**
 * The `interrupted` field a wait result carries when a user message cut it short.
 * @param pending - Whether anything was still unfinished when the wait returned.
 * @param watch - The watch the wait ran under.
 * @returns The field, or nothing when the wait was not cut short.
 */
function interruption(
	pending: boolean,
	watch: WaitWatch,
): { interrupted?: WaitInterruption } {
	return pending && watch.interjected() ? { interrupted: 'user-message' } : {};
}

/**
 * Tells the caller how to collect jobs that have not finished, naming the ids
 * and where each stands. After a wait it is the reminder that a timed-out wait
 * is a lap rather than a fault.
 * @param pending - Jobs still queued or running.
 * @param ending - How the wait ended, if one ran.
 * @returns The note.
 */
function resumeNote(
	pending: readonly QueuedJobReport[],
	ending: WaitEnding,
): string {
	const ids = pending.map((report) => `"${report.jobId}"`).join(', ');
	const opening = WAIT_ENDING_OPENINGS[ending];
	return `${opening}${pending.map(describePending).join('; ')}. Every job keeps its place and keeps running. Collect the result with ensemblr_wait_for_job({ jobIds: [${ids}] }), or drop a job you no longer need with ensemblr_cancel_job.`;
}

/**
 * Points at the full log of every settled job whose output was cut.
 * @param settled - The finished jobs.
 * @returns The note, or null when nothing was cut or no log exists.
 */
function truncatedLogNote(settled: readonly QueuedJobReport[]): string | null {
	const cut = settled.filter(
		(report) => report.omittedChars > 0 && report.logPath !== null,
	);
	return cut.length > 0
		? `Output was cut from the front; the whole of it is in ${cut.map((report) => `\`${report.logPath}\``).join(', ')} — read it with your own file tools rather than running the command again.`
		: null;
}

/**
 * Joins the notes a result earned.
 * @param notes - Candidate notes, unearned ones already null.
 * @returns The joined prose, or null when nothing was earned.
 */
function joinNotes(notes: readonly (string | null)[]): string | null {
	const earned = notes.filter((note) => note !== null);
	return earned.length > 0 ? earned.join('\n\n') : null;
}

/**
 * Reports whether a typed line ends in an unescaped backslash, which makes the
 * shell read the newline after it as a continuation rather than a submit.
 * @param line - The line typed so far.
 * @returns True when the line continues onto the next.
 */
function continuesLine(line: string): boolean {
	const trailing = line.length - line.replace(/\\+$/, '').length;
	return trailing % 2 === 1;
}

/**
 * Feeds one write into a terminal's unsubmitted line, collecting every line the
 * write would submit to the shell. A line ending in an unescaped backslash
 * continues into the next, as the shell joins them, so the joined command is
 * what is classified.
 * @param pending - What earlier writes typed and did not submit.
 * @param input - The write being admitted.
 * @returns The lines submitted, and what is left typed but unsubmitted.
 */
function submittedLines(
	pending: string,
	input: string,
): { lines: readonly string[]; rest: string } {
	const lines: string[] = [];
	let line = pending;
	for (const key of input) {
		if (LINE_DISCARD_KEYS.has(key)) {
			line = '';
		} else if (ERASE_KEYS.has(key)) {
			line = Array.from(line).slice(0, -1).join('');
		} else if (SUBMIT_KEYS.has(key) && continuesLine(line)) {
			line = line.slice(0, -1);
		} else if (SUBMIT_KEYS.has(key)) {
			lines.push(line);
			line = '';
		} else {
			line += key;
		}
	}
	return { lines, rest: line.slice(-MAX_PENDING_INPUT_CHARS) };
}

/**
 * Classifies a command, passing it if the classifier itself fails: Pi asks on
 * every `bash` call and blocks the call when the answer is an error, so an
 * exception here would cost the agent its shell rather than one command.
 * @param command - The command to classify.
 * @param settings - The live compute-queue settings.
 * @returns The verdict, or a pass when classification threw.
 */
function classifySafely(
	command: string,
	settings: ComputeQueueSettings,
): HeavyCommandVerdict {
	try {
		return classifyHeavyCommandForSettings(command, settings);
	} catch (cause) {
		console.warn(
			'[agent-control] compute-queue classification failed; passing the command.',
			{ cause, commandLength: command.length },
		);
		return { heavy: false };
	}
}

/**
 * Builds the compute-queue ops and gates.
 * @param options - The queue port, the guardrails that bound enqueues, and the
 *   interjections that end a wait early.
 * @returns The ops the agent-control service dispatches to.
 */
export function createJobQueueOps({
	port,
	guardrails,
	interjections,
}: JobQueueOpsOptions): JobQueueOps {
	const unsubmittedInput = new Map<string, string>();

	/**
	 * Clamps a caller's requested wait to the app's ceiling.
	 * @param timeoutMs - The requested wait, if any.
	 * @returns The wait to use.
	 */
	const clampWait = (timeoutMs: number | undefined): number =>
		Math.min(timeoutMs ?? guardrails.waitTimeoutMs, guardrails.waitTimeoutMs);

	/**
	 * The refusal for a heavy command, spelled for the caller's tool list.
	 * @param origin - Resolved caller identity.
	 * @param command - The command to classify.
	 * @returns The refusal, or null when the command is not heavy or no queue is wired.
	 */
	const heavyRefusal = (
		origin: AgentControlOrigin,
		command: string,
	): string | null => {
		if (!port) {
			return null;
		}
		const verdict = classifySafely(command, port.readSettings());
		return verdict.heavy
			? namespaceControlToolNames(
					heavyCommandBlockReason({
						command,
						matched: verdict.matched,
						queueToolName: QUEUE_TOOL_NAME,
						waitToolName: WAIT_TOOL_NAME,
					}),
					originToolNaming(origin),
				)
			: null;
	};

	/**
	 * Reads a job the caller may address: one in its own workspace.
	 * @param queue - The queue port.
	 * @param origin - Resolved caller identity.
	 * @param jobId - The job named.
	 * @returns The job, or the `not-found` failure for one outside the caller's reach.
	 */
	const ownJob = (
		queue: JobQueuePort,
		origin: AgentControlOrigin,
		jobId: string,
	): ComputeJobResult | AgentControlResult<never> => {
		const job = queue.getJob(jobId);
		return job && job.workspaceId === origin.workspaceId
			? job
			: fail(
					'not-found',
					`No compute-queue job ${jobId} in this workspace. A finished job leaves the queue's history after a while, so read an old one's log under \`.context/compute-queue/\` instead.`,
				);
	};

	/**
	 * Spells a note for the caller's tool list. The queue ops return command
	 * output verbatim, so their prose is namespaced here rather than by the bridge.
	 * @param origin - Resolved caller identity.
	 * @param note - The note in bare spelling, or null.
	 * @returns The note to attach, or an empty object when there is none.
	 */
	const noteFor = (
		origin: AgentControlOrigin,
		note: string | null,
	): { note?: string } =>
		note
			? { note: namespaceControlToolNames(note, originToolNaming(origin)) }
			: {};

	/**
	 * Waits on jobs within the app's ceiling under a watch a user steer ends
	 * early, releasing the watch however the wait returns.
	 * @param queue - The queue port.
	 * @param origin - Resolved caller identity, whose steer ends the wait.
	 * @param jobIds - The jobs to wait on.
	 * @param wait - The calling turn's abort signal and the requested timeout.
	 * @returns The queue's wait result, and the watch to read how it ended.
	 */
	const watchedWait = async (
		queue: JobQueuePort,
		origin: AgentControlOrigin,
		jobIds: readonly string[],
		wait: { signal: AbortSignal | undefined; timeoutMs: number | undefined },
	): Promise<{
		waited: Awaited<ReturnType<JobQueuePort['waitFor']>>;
		watch: WaitWatch;
	}> => {
		const watch = interjections.watch(origin.sessionId, wait.signal);
		try {
			const waited = await queue.waitFor(jobIds, {
				signal: watch.signal,
				timeoutMs: clampWait(wait.timeoutMs),
			});
			return { waited, watch };
		} finally {
			watch.release();
		}
	};

	/**
	 * Queues a command and, unless told not to, waits for it within the app's
	 * wait ceiling. The enqueue is bounded per delegation tree before the queue
	 * sees it, so a runaway loop cannot fill the machine's queue.
	 * @param origin - Resolved caller identity.
	 * @param args - The command, where to run it, and how long to wait.
	 * @param signal - Aborts when the calling turn ends, ending the wait but not the job.
	 * @returns The job report, or why it was refused.
	 */
	const runQueued = async (
		origin: AgentControlOrigin,
		args: RunQueuedArgs,
		signal: AbortSignal | undefined,
	): Promise<AgentControlResult<unknown>> => {
		if (!port) {
			return fail('internal', QUEUE_UNAVAILABLE);
		}
		const rootSessionId = origin.rootSessionId ?? origin.sessionId;
		const unfinished = port
			.listJobs({ rootSessionId })
			.filter((job) => !isComputeJobFinished(job.state)).length;
		const reservation = guardrails.reserveJobEnqueue(origin, unfinished);
		if (!reservation.ok) {
			return fail(reservation.code, reservation.reason);
		}
		let outcome: Awaited<ReturnType<JobQueuePort['enqueueCommand']>>;
		try {
			outcome = await port.enqueueCommand({
				command: args.command,
				...(args.cwd ? { cwd: args.cwd } : {}),
				initiator: 'agent',
				...(args.label ? { label: args.label } : {}),
				rootSessionId,
				sessionId: origin.sessionId,
				workspaceId: origin.workspaceId,
			});
		} catch (error) {
			reservation.refund();
			throw error;
		}
		if (!outcome.ok) {
			reservation.refund();
			return fail(
				outcome.code === 'invalid-cwd' ? 'invalid-args' : 'not-found',
				outcome.message,
			);
		}
		reservation.settle();
		const jobId = outcome.job.id;
		const watched =
			args.wait === false
				? null
				: await watchedWait(port, origin, [jobId], {
						signal,
						timeoutMs: args.timeoutMs,
					});
		const job = port.getJob(jobId);
		if (!job) {
			return fail('internal', `Compute-queue job ${jobId} vanished.`);
		}
		const finished = isComputeJobFinished(job.state);
		const render = (reports: readonly QueuedJobReport[]): RunQueuedResult => ({
			job: reports[0],
			timedOut: watched?.waited.timedOut ?? false,
			...(watched ? interruption(!finished, watched.watch) : {}),
		});
		const [report] = fitReports([toReport(job, origin.workspaceCwd)], render);
		return ok({
			...render([report]),
			...noteFor(
				origin,
				finished
					? truncatedLogNote([report])
					: resumeNote([report], watched ? waitEnding(watched.watch) : 'none'),
			),
		} satisfies RunQueuedResult);
	};

	/**
	 * Waits until every named job — by default every unfinished job the session
	 * queued — has finished, or the wait ceiling passes.
	 * @param origin - Resolved caller identity.
	 * @param args - The jobs to wait on and how long.
	 * @param signal - Aborts when the calling turn ends.
	 * @returns The settled and pending jobs, or `not-found` for a job outside the workspace.
	 */
	const waitForJob = async (
		origin: AgentControlOrigin,
		args: WaitForJobArgs,
		signal: AbortSignal | undefined,
	): Promise<AgentControlResult<unknown>> => {
		if (!port) {
			return fail('internal', QUEUE_UNAVAILABLE);
		}
		const jobIds =
			args.jobIds ??
			port
				.listJobs({ sessionId: origin.sessionId })
				.filter((job) => !isComputeJobFinished(job.state))
				.map((job) => job.id);
		if (jobIds.length === 0) {
			return ok({
				pending: [],
				settled: [],
				timedOut: false,
				note: 'This session has no compute-queue jobs queued or running, so there is nothing to wait on. Name a finished job in `jobIds` to read its result again.',
			} satisfies WaitForJobResult);
		}
		for (const jobId of jobIds) {
			const owned = ownJob(port, origin, jobId);
			if ('ok' in owned) {
				return owned;
			}
		}
		const { waited, watch } = await watchedWait(port, origin, jobIds, {
			signal,
			timeoutMs: args.timeoutMs,
		});
		const reports = fitReports(
			[...waited.settled, ...waited.pending].map((job) =>
				toReport(job, origin.workspaceCwd),
			),
			(fitted) => ({ fitted, timedOut: waited.timedOut }),
		);
		const settled = reports.slice(0, waited.settled.length);
		const pending = reports.slice(waited.settled.length);
		return ok({
			pending,
			settled,
			timedOut: waited.timedOut,
			...interruption(pending.length > 0, watch),
			...noteFor(
				origin,
				joinNotes([
					pending.length > 0 ? resumeNote(pending, waitEnding(watch)) : null,
					truncatedLogNote(settled),
				]),
			),
		} satisfies WaitForJobResult);
	};

	/**
	 * Reports whether the caller may cancel a job: one an agent queued in the
	 * caller's own delegation tree. A job the user started, one the app started
	 * on its own, and another tree's are not the caller's to drop.
	 * @param queue - The queue port.
	 * @param origin - Resolved caller identity.
	 * @param job - A job already known to be in the caller's workspace.
	 * @returns True when the job is the caller's tree's.
	 */
	const cancellable = (
		queue: JobQueuePort,
		origin: AgentControlOrigin,
		job: ComputeJobResult,
	): boolean => {
		if (job.initiator !== 'agent') {
			return false;
		}
		const rootSessionId = origin.rootSessionId ?? origin.sessionId;
		return (
			job.sessionId === origin.sessionId ||
			queue.listJobs({ rootSessionId }).some((tree) => tree.id === job.id)
		);
	};

	/**
	 * Cancels a queued job, or stops a running one, that the caller's own
	 * delegation tree queued.
	 * @param origin - Resolved caller identity.
	 * @param args - The job to cancel.
	 * @returns Whether anything was cancelled and the job as it now stands, or why it is not the caller's to cancel.
	 */
	const cancelJob = (
		origin: AgentControlOrigin,
		args: CancelJobArgs,
	): AgentControlResult<unknown> => {
		if (!port) {
			return fail('internal', QUEUE_UNAVAILABLE);
		}
		const owned = ownJob(port, origin, args.jobId);
		if ('ok' in owned) {
			return owned;
		}
		if (!cancellable(port, origin, owned)) {
			return fail(
				'denied-scope',
				`Compute-queue job ${args.jobId} was not queued by your delegation tree — the user, the app, or another agent's tree started it — so it is not yours to cancel.`,
			);
		}
		const cancelled = port.cancel(args.jobId);
		const job = port.getJob(args.jobId);
		const [report] = job
			? fitReports([toReport(job, origin.workspaceCwd)], (fitted) => ({
					cancelled,
					job: fitted[0],
				}))
			: [null];
		return ok({ cancelled, job: report ?? null } satisfies CancelJobResult);
	};

	/**
	 * Admits one terminal write, remembering what it typed but did not submit so
	 * a command split across writes is classified whole.
	 * @param origin - Resolved caller identity.
	 * @param terminalId - The shell terminal being written to.
	 * @param input - The write.
	 * @returns The refusal when a submitted line is heavy, else null.
	 */
	const admitTerminalInput = (
		origin: AgentControlOrigin,
		terminalId: string,
		input: string,
	): string | null => {
		const { lines, rest } = submittedLines(
			unsubmittedInput.get(terminalId) ?? '',
			input,
		);
		for (const line of lines) {
			const refusal = heavyRefusal(origin, line);
			if (refusal) {
				return refusal;
			}
		}
		if (rest === '') {
			unsubmittedInput.delete(terminalId);
		} else {
			unsubmittedInput.set(terminalId, rest);
		}
		return null;
	};

	return {
		admitTerminalInput,
		cancelJob,
		releaseSession: (sessionId) => port?.releaseSession(sessionId),
		runQueued,
		shellCommandRefusal: heavyRefusal,
		waitForJob,
	};
}
