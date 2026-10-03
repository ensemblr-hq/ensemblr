import { randomUUID } from 'node:crypto';

import {
	type ComputeJobSnapshot,
	type ComputeQueueSnapshot,
	isComputeJobFinished,
} from '../../shared/compute-queue.ts';
import type { ComputeQueueSettings } from '../../shared/config.ts';
import {
	type CommandRun,
	type CommandStarter,
	startCommandProcess,
} from './command-runner.ts';
import { computeGrantOrder } from './grant-order.ts';
import {
	type JobRecord,
	resolveJobCwd,
	toJobResult,
	toJobSnapshot,
} from './job-record.ts';
import type {
	ComputeJobFilter,
	ComputeJobOwner,
	ComputeJobResult,
	ComputeQueueService,
	ScriptLease,
} from './types.ts';
import { createJobWaiters } from './wait-for-jobs.ts';

/** Grace between SIGTERM and SIGKILL when a running command is stopped. */
const DEFAULT_KILL_GRACE_MS = 5_000;

/** Finished jobs kept so `getJob` and `waitFor` still answer after completion. */
const DEFAULT_HISTORY_LIMIT = 200;

/** Finished jobs a snapshot lists alongside the live ones. */
const DEFAULT_SNAPSHOT_FINISHED_LIMIT = 20;

/**
 * Most recently finished jobs that keep their output tail in memory. Older
 * history keeps its metadata and log path; the tail is dropped to bound memory.
 */
const DEFAULT_RETAINED_TAIL_LIMIT = 50;

/** The workspace overlay a command launch merges onto the inherited environment. */
export interface AssembledComputeEnvironment {
	env: Record<string, string>;
	redactValues: readonly string[];
}

/** Everything environmental the queue needs, injected so tests need no Electron. */
export interface CreateComputeQueueServiceOptions {
	/** Workspace variables and secrets for a launch; may throw, which fails the job. */
	assembleEnvironment: (
		workspaceId: string,
	) => Promise<AssembledComputeEnvironment>;
	/** Inherited environment the overlay is merged onto; falls back to `process.env` on failure. */
	baseEnvironment: () =>
		| Promise<Record<string, string | undefined>>
		| Record<string, string | undefined>;
	createId?: () => string;
	historyLimit?: number;
	killGraceMs?: number;
	now?: () => number;
	/** Current compute-queue settings; read on every scheduling decision. */
	readSettings: () => ComputeQueueSettings;
	/** Finished jobs that keep their output tail; see {@link DEFAULT_RETAINED_TAIL_LIMIT}. */
	retainedTailLimit?: number;
	resolveWorkspace: (
		workspaceId: string,
	) => { name: string; path: string } | null;
	snapshotFinishedLimit?: number;
	/** Spawns a granted command; replaced by a fake in scheduler tests. */
	startCommand?: CommandStarter;
	/** Stops the dock terminal running a script job that was cancelled; may throw. */
	stopScriptTerminal?: (terminalId: string) => void;
}

/**
 * Builds the app-wide compute queue. See {@link ComputeQueueService} for the
 * contract; this module owns the job table, slot accounting, and the command
 * and script-lease lifecycles, and delegates spawning to the command runner.
 * @param options - Injected settings, workspace, and environment sources.
 * @returns The queue service.
 */
export function createComputeQueueService(
	options: CreateComputeQueueServiceOptions,
): ComputeQueueService {
	const now = options.now ?? Date.now;
	const createId = options.createId ?? randomUUID;
	const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
	const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
	const finishedLimit =
		options.snapshotFinishedLimit ?? DEFAULT_SNAPSHOT_FINISHED_LIMIT;
	const retainedTailLimit =
		options.retainedTailLimit ?? DEFAULT_RETAINED_TAIL_LIMIT;
	const startCommand = options.startCommand ?? startCommandProcess;

	const records = new Map<string, JobRecord>();
	const finishedOrder: string[] = [];
	const runs = new Map<string, CommandRun>();
	const leaseResolvers = new Map<
		string,
		(outcome: 'cancelled' | 'granted') => void
	>();
	const launches = new Set<Promise<void>>();
	const lastGrantTicks = new Map<string, number>();
	const listeners = new Set<(snapshot: ComputeQueueSnapshot) => void>();
	const waiters = createJobWaiters();
	let sequence = 0;
	let grantTick = 0;
	let shutdownPromise: Promise<void> | null = null;

	/**
	 * Replaces a record with a patched copy.
	 * @param id - Job id.
	 * @param patch - Fields to change.
	 * @returns The new record, or null when the job is unknown.
	 */
	function update(id: string, patch: Partial<JobRecord>): JobRecord | null {
		const current = records.get(id);
		if (current === undefined) {
			return null;
		}
		const next = { ...current, ...patch };
		records.set(id, next);
		return next;
	}

	/** Running jobs of every initiator, which is what holds slots. */
	function countInUse(): number {
		return Array.from(records.values()).filter(
			(record) => record.state === 'running',
		).length;
	}

	/** Queued jobs that wait their turn, in grant order. */
	function queuedInGrantOrder(): string[] {
		const waiting = Array.from(records.values()).filter(
			(record) => record.state === 'queued',
		);
		return computeGrantOrder(waiting, lastGrantTicks);
	}

	/**
	 * Builds a job's public snapshot with its live position and workspace name.
	 * @param record - The job record.
	 * @param positions - Grant-order positions of queued jobs.
	 * @returns The snapshot.
	 */
	function snapshotOf(
		record: JobRecord,
		positions: ReadonlyMap<string, number>,
	): ComputeJobSnapshot {
		const workspaceName =
			options.resolveWorkspace(record.workspaceId)?.name ?? null;
		return toJobSnapshot(
			record,
			positions.get(record.id) ?? null,
			workspaceName,
		);
	}

	/** Grant-order positions of every queued job, one-based. */
	function currentPositions(): Map<string, number> {
		return new Map(queuedInGrantOrder().map((id, index) => [id, index + 1]));
	}

	/**
	 * Builds the agent-facing result for a job, reading a live run's tail.
	 * @param id - Job id.
	 * @param positions - Queue positions, when the caller already computed them.
	 * @returns The result, or null when unknown.
	 */
	function resultOf(
		id: string,
		positions?: ReadonlyMap<string, number>,
	): ComputeJobResult | null {
		const record = records.get(id);
		if (record === undefined) {
			return null;
		}
		const live = runs.get(id)?.tail();
		const output = live ?? {
			omittedChars: record.omittedChars,
			text: record.outputTail,
		};
		return toJobResult(
			snapshotOf(record, positions ?? currentPositions()),
			output,
		);
	}

	/**
	 * The queue as it stands now.
	 * @param positions - Queue positions, when the caller already computed them.
	 * @returns The snapshot.
	 */
	function snapshot(
		positions: ReadonlyMap<string, number> = currentPositions(),
	): ComputeQueueSnapshot {
		const settings = options.readSettings();
		const recentFinished = new Set(finishedOrder.slice(-finishedLimit));
		const jobs = Array.from(records.values())
			.filter(
				(record) =>
					!isComputeJobFinished(record.state) || recentFinished.has(record.id),
			)
			.sort((a, b) => a.sequence - b.sequence)
			.map((record) => snapshotOf(record, positions));

		return {
			enabled: settings.enabled,
			inUse: countInUse(),
			jobs,
			slots: effectiveSlots(settings),
		};
	}

	/** Notifies subscribers and re-checks pending waits. */
	function emit(): void {
		const positions = currentPositions();
		const current = snapshot(positions);
		for (const listener of listeners) {
			try {
				listener(current);
			} catch {}
		}
		waiters.check((id) => resultOf(id, positions));
	}

	/**
	 * Drops the output tail of the finished job that just left the retained
	 * window, and the oldest finished jobs beyond the history limit.
	 */
	function pruneHistory(): void {
		const leavingTail = finishedOrder.at(-(retainedTailLimit + 1));
		const leaving =
			leavingTail === undefined ? undefined : records.get(leavingTail);
		if (leaving !== undefined && leaving.outputTail !== '') {
			update(leaving.id, {
				omittedChars: leaving.omittedChars + leaving.outputTail.length,
				outputTail: '',
			});
		}
		while (finishedOrder.length > historyLimit) {
			const expired = finishedOrder.shift();
			if (expired !== undefined) {
				records.delete(expired);
			}
		}
	}

	/**
	 * Moves a job to a terminal state, frees its slot, and wakes the scheduler.
	 * A no-op for a job that already finished.
	 * @param id - Job id.
	 * @param patch - Final state plus any outcome fields.
	 */
	function finish(
		id: string,
		patch: Partial<JobRecord> & Pick<JobRecord, 'state'>,
	): void {
		const current = records.get(id);
		if (current === undefined || isComputeJobFinished(current.state)) {
			return;
		}
		update(id, { ...patch, endedAt: now() });
		leaseResolvers.get(id)?.('cancelled');
		leaseResolvers.delete(id);
		finishedOrder.push(id);
		pruneHistory();
		pumpAndEmit();
	}

	/**
	 * Gives a queued job its slot and starts whatever it runs.
	 * @param id - Job id.
	 */
	function grant(id: string): void {
		const record = update(id, { startedAt: now(), state: 'running' });
		if (record === null) {
			return;
		}
		grantTick += 1;
		lastGrantTicks.set(record.workspaceId, grantTick);
		if (record.kind === 'script') {
			leaseResolvers.get(id)?.('granted');
			leaseResolvers.delete(id);
			return;
		}
		const launch = launchCommand(record)
			.catch((error: unknown) => {
				console.warn(`[compute-queue] launch of job ${id} failed`, error);
				runs.delete(id);
				finish(id, {
					outputTail: `Could not start the command: ${describeError(error)}\n`,
					state: 'failed',
				});
			})
			.finally(() => launches.delete(launch));
		launches.add(launch);
	}

	/** Grants every job the current settings allow to start. */
	function pump(): void {
		if (shutdownPromise !== null) {
			return;
		}
		const settings = options.readSettings();
		for (const record of Array.from(records.values())) {
			if (
				record.state === 'queued' &&
				(!settings.enabled || record.initiator === 'user')
			) {
				grant(record.id);
			}
		}
		const slots = effectiveSlots(settings);
		while (countInUse() < slots) {
			const next = queuedInGrantOrder()[0];
			if (next === undefined) {
				return;
			}
			grant(next);
		}
	}

	/** Schedules then publishes, the tail of every state change. */
	function pumpAndEmit(): void {
		pump();
		emit();
	}

	/**
	 * Resolves the inherited environment, falling back to the app's own.
	 * @returns The base environment for a launch.
	 */
	async function resolveBaseEnvironment(): Promise<
		Record<string, string | undefined>
	> {
		try {
			return await options.baseEnvironment();
		} catch {
			return process.env;
		}
	}

	/**
	 * Runs a granted command job to completion: assembles its environment,
	 * spawns it, and records the outcome. Never rejects.
	 * @param record - The job as it was granted.
	 */
	async function launchCommand(record: JobRecord): Promise<void> {
		let assembled: AssembledComputeEnvironment;
		try {
			assembled = await options.assembleEnvironment(record.workspaceId);
		} catch (error) {
			if (records.get(record.id)?.cancelRequested) {
				finish(record.id, { state: 'cancelled' });
				return;
			}
			finish(record.id, {
				outputTail: `Could not assemble the workspace environment: ${describeError(error)}\n`,
				state: 'failed',
			});
			return;
		}
		const baseEnv = await resolveBaseEnvironment();
		if (records.get(record.id)?.cancelRequested !== false) {
			finish(record.id, { state: 'cancelled' });
			return;
		}

		let run: CommandRun;
		try {
			run = startCommand({
				baseEnv,
				command: record.command,
				cwd: record.cwd ?? record.workspacePath ?? '',
				jobId: record.id,
				killGraceMs,
				niceness: options.readSettings().niceness,
				overlay: assembled.env,
				redactValues: assembled.redactValues,
				workspacePath: record.workspacePath ?? '',
			});
		} catch (error) {
			finish(record.id, {
				outputTail: `Could not start the command: ${describeError(error)}\n`,
				state: 'failed',
			});
			return;
		}
		runs.set(record.id, run);
		update(record.id, { logPath: run.logPath });
		emit();

		const outcome = await run.done;
		const tail = run.tail();
		runs.delete(record.id);
		const cancelled = records.get(record.id)?.cancelRequested === true;
		finish(record.id, {
			exitCode: outcome.exitCode,
			omittedChars: tail.omittedChars,
			outputTail: tail.text,
			signal: outcome.signal,
			state: cancelled
				? 'cancelled'
				: outcome.exitCode === 0
					? 'succeeded'
					: 'failed',
		});
	}

	/**
	 * Creates a queued record for a new job.
	 * @param owner - Who submitted it.
	 * @param fields - What it runs and where.
	 * @returns The stored record.
	 */
	function createRecord(
		owner: ComputeJobOwner,
		fields: Pick<
			JobRecord,
			'command' | 'cwd' | 'kind' | 'label' | 'workspacePath'
		>,
	): JobRecord {
		sequence += 1;
		const record: JobRecord = {
			...fields,
			cancelRequested: false,
			endedAt: null,
			enqueuedAt: now(),
			exitCode: null,
			id: createId(),
			initiator: owner.initiator,
			logPath: null,
			omittedChars: 0,
			outputTail: '',
			rootSessionId: owner.rootSessionId ?? null,
			sequence,
			sessionId: owner.sessionId ?? null,
			signal: null,
			startedAt: null,
			state: 'queued',
			terminalId: null,
			workspaceId: owner.workspaceId,
		};
		records.set(record.id, record);
		return record;
	}

	/**
	 * Queues a new record, or cancels it at once when the queue is shutting down.
	 * @param record - The freshly created record.
	 */
	function admit(record: JobRecord): void {
		if (shutdownPromise !== null) {
			finish(record.id, { state: 'cancelled' });
			return;
		}
		pumpAndEmit();
	}

	/**
	 * Stops a running script's terminal if both the stopper and the terminal
	 * exist. A terminal the service already forgot throws; that is logged rather
	 * than allowed to abort the cancel that asked for it.
	 * @param terminalId - Terminal to stop.
	 */
	function stopTerminal(terminalId: string | null): void {
		if (terminalId === null) {
			return;
		}
		try {
			options.stopScriptTerminal?.(terminalId);
		} catch (error) {
			console.warn(
				`[compute-queue] could not stop terminal ${terminalId}`,
				error,
			);
		}
	}

	/**
	 * Cancels one job; see {@link ComputeQueueService.cancel}.
	 * @param id - Job id.
	 * @returns False when the job is unknown or already finished.
	 */
	function cancel(id: string): boolean {
		const record = records.get(id);
		if (record === undefined || isComputeJobFinished(record.state)) {
			return false;
		}
		if (record.state === 'queued') {
			finish(id, { state: 'cancelled' });
			return true;
		}
		update(id, { cancelRequested: true });
		const run = runs.get(id);
		if (record.kind === 'command' && run !== undefined) {
			run.terminate();
		} else if (record.kind === 'command' || record.terminalId === null) {
			finish(id, { state: 'cancelled' });
			return true;
		} else {
			stopTerminal(record.terminalId);
		}
		emit();
		return true;
	}

	/**
	 * Cancels every unfinished job matching a predicate. One job whose cancel
	 * throws is logged and skipped, so it cannot spare the rest.
	 * @param matches - Selects the jobs to cancel.
	 */
	function cancelWhere(matches: (record: JobRecord) => boolean): void {
		for (const record of Array.from(records.values())) {
			if (isComputeJobFinished(record.state) || !matches(record)) {
				continue;
			}
			try {
				cancel(record.id);
			} catch (error) {
				console.warn(
					`[compute-queue] could not cancel job ${record.id}`,
					error,
				);
			}
		}
	}

	/**
	 * Cancels everything and waits for in-flight launches; a later call kills
	 * whatever is still running. Never throws, and every call returns the
	 * promise of the first.
	 * @returns Settles once every launch has finished.
	 */
	function shutdown(): Promise<void> {
		if (shutdownPromise !== null) {
			for (const run of runs.values()) {
				run.kill();
			}
			return shutdownPromise;
		}
		shutdownPromise = Promise.resolve();
		cancelWhere(() => true);
		shutdownPromise = Promise.all(Array.from(launches)).then(() => undefined);
		return shutdownPromise;
	}

	/**
	 * Builds the lease handle for a script job.
	 * @param id - The script job's id.
	 * @param granted - Resolves when the job is granted or cancelled.
	 * @returns The lease.
	 */
	function createLease(
		id: string,
		granted: ScriptLease['granted'],
	): ScriptLease {
		return {
			/**
			 * Ends a job whose launch opened no terminal, recording why.
			 * @param outcome - Whether it failed or was refused, and the reason.
			 */
			abandon: ({ failed, note }) => {
				const record = records.get(id);
				if (record === undefined || isComputeJobFinished(record.state)) {
					return;
				}
				finish(id, {
					outputTail: note.endsWith('\n') ? note : `${note}\n`,
					state: failed && !record.cancelRequested ? 'failed' : 'cancelled',
				});
			},
			/**
			 * Ties the job to the terminal its launch opened, stopping that
			 * terminal at once when the job was cancelled in the meantime.
			 * @param terminalId - The launched terminal.
			 */
			attachTerminal: (terminalId) => {
				const record = update(id, { terminalId });
				if (record?.cancelRequested || record?.state === 'cancelled') {
					stopTerminal(terminalId);
				}
				emit();
			},
			/**
			 * Updates what the job says it runs, after a launch that waited
			 * re-read its command; the job keeps the slot it was granted.
			 * @param description - The command it now runs and its label.
			 */
			describe: ({ command, label }) => {
				const record = records.get(id);
				if (record === undefined || isComputeJobFinished(record.state)) {
					return;
				}
				update(id, { command, label });
				emit();
			},
			granted,
			jobId: id,
			/**
			 * Frees the slot with the terminal's outcome; a no-op once finished.
			 * @param outcome - The terminal's exit code and signal.
			 */
			release: ({ exitCode, signal }) => {
				const record = records.get(id);
				if (record === undefined || isComputeJobFinished(record.state)) {
					return;
				}
				const state =
					record.state === 'queued' || record.cancelRequested
						? 'cancelled'
						: exitCode === 0
							? 'succeeded'
							: 'failed';
				finish(id, { exitCode, signal: signal ?? null, state });
			},
		};
	}

	/**
	 * Matches records against a listing filter.
	 * @param record - Candidate record.
	 * @param filter - Optional narrowing.
	 * @returns True when the record passes every given field.
	 */
	function matchesFilter(
		record: JobRecord,
		filter: ComputeJobFilter = {},
	): boolean {
		return (
			(filter.workspaceId === undefined ||
				record.workspaceId === filter.workspaceId) &&
			(filter.sessionId === undefined ||
				record.sessionId === filter.sessionId) &&
			(filter.rootSessionId === undefined ||
				record.rootSessionId === filter.rootSessionId)
		);
	}

	return {
		acquireScriptLease: (request) => {
			const record = createRecord(request, {
				command: request.command,
				cwd: null,
				kind: 'script',
				label: request.label,
				workspacePath: null,
			});
			const granted = new Promise<'cancelled' | 'granted'>((resolve) => {
				leaseResolvers.set(record.id, resolve);
			});
			admit(record);
			return createLease(record.id, granted);
		},
		cancel,
		enqueueCommand: async (request) => {
			const workspace = options.resolveWorkspace(request.workspaceId);
			if (workspace === null) {
				return { code: 'not-found', message: 'Unknown workspace.', ok: false };
			}
			const cwd = resolveJobCwd(workspace.path, request.cwd);
			if (cwd === null) {
				return {
					code: 'invalid-cwd',
					message: 'cwd must be an existing directory inside the workspace.',
					ok: false,
				};
			}
			const record = createRecord(request, {
				command: request.command,
				cwd,
				kind: 'command',
				label: request.label?.trim() || request.command,
				workspacePath: workspace.path,
			});
			admit(record);
			return {
				job: snapshotOf(records.get(record.id) ?? record, currentPositions()),
				ok: true,
			};
		},
		getJob: (jobId) => resultOf(jobId),
		listJobs: (filter) => {
			const positions = currentPositions();
			return Array.from(records.values())
				.filter((record) => matchesFilter(record, filter))
				.sort((a, b) => a.sequence - b.sequence)
				.map((record) => snapshotOf(record, positions));
		},
		onChange: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		refresh: pumpAndEmit,
		releaseSession: (sessionId) =>
			cancelWhere(
				(record) => record.kind === 'command' && record.sessionId === sessionId,
			),
		releaseWorkspace: (workspaceId) =>
			cancelWhere((record) => record.workspaceId === workspaceId),
		shutdown,
		snapshot: () => snapshot(),
		waitFor: (jobIds, waitOptions) =>
			waiters.add(
				jobIds.filter((id) => records.has(id)),
				waitOptions,
				(jobId) => resultOf(jobId),
			),
	};
}

/**
 * The slot count scheduling actually enforces: at least one, whatever the
 * settings say, so a zero never stalls the queue.
 * @param settings - Current compute-queue settings.
 * @returns The effective number of slots.
 */
function effectiveSlots(settings: ComputeQueueSettings): number {
	return Math.max(1, settings.concurrency);
}

/**
 * Formats a thrown value for a job's output tail.
 * @param error - What was thrown.
 * @returns Its message.
 */
function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
