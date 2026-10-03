import {
	type ComputeJobInitiator,
	classifyHeavyCommandForSettings,
} from '../../shared/compute-queue.ts';
import type { ComputeQueueSettings } from '../../shared/config.ts';
import type { CreateTerminalSessionResult } from '../../shared/ipc/contracts/terminal';
import type { WorkspaceScriptKind } from '../../shared/ipc/contracts/workspace-scripts';
import type { ComputeQueueService, ScriptLease } from '../compute-queue';
import type { TerminalService } from '../terminal';
import { failure, type ScriptLaunch } from './script-launch.ts';

/** Who asked for a script launch, as the compute queue attributes it. */
export interface ScriptLaunchOwner {
	initiator: ComputeJobInitiator;
	rootSessionId?: string | null;
	sessionId?: string | null;
}

/**
 * Performs a launch once it holds its slot. `deferred` is true when the launch
 * waited in the queue first, so the caller re-reads anything that may have
 * changed while it waited and reports a changed command through `describe`.
 */
export type ScriptLaunchStarter = (options: {
	deferred: boolean;
	describe?: (command: string) => void;
}) => Promise<CreateTerminalSessionResult>;

/** The slice of the compute queue the script gate drives. */
export type ScriptComputeQueue = Pick<
	ComputeQueueService,
	'acquireScriptLease' | 'cancel' | 'getJob'
>;

/**
 * Puts heavy repository scripts behind the app-wide compute queue. A launch
 * that needs no slot, or one the queue grants at once, starts immediately and
 * holds its slot until its terminal exits; one that has to wait answers with
 * its queued job and starts in the background when the slot comes.
 */
export interface ScriptQueueGate {
	/**
	 * Starts the launch now while holding a slot, or queues it.
	 * @returns The launch's own result, or a session-less result naming the queued job.
	 */
	admit: (request: {
		launch: ScriptLaunch;
		owner: ScriptLaunchOwner;
		start: ScriptLaunchStarter;
	}) => Promise<CreateTerminalSessionResult>;
	/** Cancels every launch of a kind still waiting for a slot in a workspace; true when one was. */
	cancelQueued: (workspaceId: string, kind: WorkspaceScriptKind) => boolean;
	/** True when the launch is heavy and the queue is on, so it must hold a slot. */
	requiresSlot: (launch: ScriptLaunch) => boolean;
}

/** A launch waiting for its slot. */
interface QueuedLaunch {
	initiator: ComputeJobInitiator;
	jobId: string;
	kind: WorkspaceScriptKind;
	workspaceId: string;
}

/**
 * Builds the gate between script launches and the compute queue.
 * @param deps - The queue, its live settings, and the terminal service whose exits release slots.
 * @returns A fresh {@link ScriptQueueGate}.
 */
export function createScriptQueueGate({
	computeQueue,
	readComputeQueueSettings,
	terminalService,
}: {
	computeQueue: ScriptComputeQueue;
	readComputeQueueSettings: () => ComputeQueueSettings;
	terminalService: Pick<TerminalService, 'getSnapshot' | 'waitForExit'>;
}): ScriptQueueGate {
	const queuedLaunches = new Map<string, QueuedLaunch>();

	/**
	 * Answers a launch that is waiting for a slot.
	 * @param jobId - The queued job.
	 * @returns A session-less result carrying the job and its live position.
	 */
	function queuedResult(jobId: string): CreateTerminalSessionResult {
		return {
			diagnostics: [],
			queuedJob: {
				jobId,
				position: computeQueue.getJob(jobId)?.position ?? null,
			},
			session: null,
		};
	}

	/**
	 * Frees the slot of a launch that never produced a terminal, recording why on
	 * the job: a spawn error counts as a failed job, a refusal such as a
	 * running-script conflict as a cancelled one. A failure is logged too, since
	 * a launch that waited in the queue has no caller left to report it to.
	 * @param lease - The lease the launch held.
	 * @param result - What the launch answered.
	 */
	function settleUnlaunched(
		lease: ScriptLease,
		result: CreateTerminalSessionResult,
	): void {
		const failed = result.diagnostics.some(
			(diagnostic) => diagnostic.severity === 'error',
		);
		const note = result.diagnostics
			.map((diagnostic) => diagnostic.message)
			.join('\n');

		if (failed) {
			console.warn(
				`[scripts] script job ${lease.jobId} did not start: ${note}`,
			);
		}

		lease.abandon({ failed, note });
	}

	/**
	 * Runs a granted launch and ties its slot to the terminal it opens, releasing
	 * the slot with the terminal's exit code once it ends.
	 * @param lease - The granted lease.
	 * @param start - Performs the launch.
	 * @param deferred - Whether the launch waited in the queue first.
	 * @returns The launch's result.
	 */
	async function launchHolding(
		lease: ScriptLease,
		start: ScriptLaunchStarter,
		deferred: boolean,
	): Promise<CreateTerminalSessionResult> {
		let result: CreateTerminalSessionResult;

		if (computeQueue.getJob(lease.jobId)?.state !== 'running') {
			return failure(
				'script-queue-cancelled',
				'The script was cancelled before it started.',
				'info',
			);
		}

		try {
			result = await start({
				deferred,
				describe: (command) => lease.describe({ command, label: command }),
			});
		} catch (error) {
			lease.abandon({ failed: true, note: describeLaunchError(error) });
			throw error;
		}

		const terminalId = result.session?.id;

		if (!terminalId) {
			settleUnlaunched(lease, result);
			return result;
		}

		lease.attachTerminal(terminalId);
		void terminalService
			.waitForExit(terminalId)
			.then(() =>
				lease.release({
					exitCode:
						terminalService.getSnapshot(terminalId).session?.exitCode ?? null,
				}),
			)
			.catch((error: unknown) => {
				console.warn(
					`[scripts] lost track of terminal ${terminalId}; freeing its slot`,
					error,
				);
				lease.release({ exitCode: null });
			});

		return result;
	}

	/**
	 * Parks a launch until its lease is granted, then starts it in the
	 * background; a cancelled lease never launches.
	 * @param key - The launch's queue key.
	 * @param entry - The waiting launch.
	 * @param lease - Its lease.
	 * @param start - Performs the launch.
	 */
	function launchWhenGranted(
		key: string,
		entry: QueuedLaunch,
		lease: ScriptLease,
		start: ScriptLaunchStarter,
	): void {
		queuedLaunches.set(key, entry);
		void lease.granted
			.then((outcome) => {
				if (queuedLaunches.get(key) === entry) {
					queuedLaunches.delete(key);
				}

				return outcome === 'granted'
					? launchHolding(lease, start, true)
					: undefined;
			})
			.catch((error: unknown) => {
				console.warn(
					`[scripts] queued ${entry.kind} script job ${entry.jobId} failed to launch`,
					error,
				);
			});
	}

	return {
		admit: async ({ launch, owner, start }) => {
			const key = queueKey(launch);
			const waiting = queuedLaunches.get(key);

			if (waiting) {
				if (owner.initiator !== 'user' || waiting.initiator === 'user') {
					return queuedResult(waiting.jobId);
				}

				queuedLaunches.delete(key);
				computeQueue.cancel(waiting.jobId);
			}

			const lease = computeQueue.acquireScriptLease({
				...owner,
				command: launch.command,
				label: launch.command,
				script: { kind: launch.kind, name: launch.scriptName },
				workspaceId: launch.workspaceId,
			});
			const state = computeQueue.getJob(lease.jobId)?.state;

			if (state === 'running') {
				return launchHolding(lease, start, false);
			}

			if (state !== 'queued') {
				return failure(
					'script-queue-cancelled',
					`The ${launch.kind} script was cancelled before it started.`,
					'info',
				);
			}

			launchWhenGranted(
				key,
				{
					initiator: owner.initiator,
					jobId: lease.jobId,
					kind: launch.kind,
					workspaceId: launch.workspaceId,
				},
				lease,
				start,
			);

			return queuedResult(lease.jobId);
		},
		cancelQueued: (workspaceId, kind) => {
			const matching = Array.from(queuedLaunches.entries()).filter(
				([, entry]) => entry.workspaceId === workspaceId && entry.kind === kind,
			);

			for (const [key, entry] of matching) {
				queuedLaunches.delete(key);
				computeQueue.cancel(entry.jobId);
			}

			return matching.length > 0;
		},
		requiresSlot: (launch) => isHeavyLaunch(launch, readComputeQueueSettings()),
	};
}

/**
 * Decides whether a launch competes for a compute slot: every setup script,
 * a run script whose command classifies heavy, never an archive script, and
 * nothing at all while the queue is off.
 * @param launch - The resolved launch.
 * @param settings - The live compute-queue settings.
 * @returns True when the launch must hold a slot.
 */
function isHeavyLaunch(
	launch: ScriptLaunch,
	settings: ComputeQueueSettings,
): boolean {
	if (!settings.enabled) {
		return false;
	}

	switch (launch.kind) {
		case 'archive':
			return false;
		case 'run':
			return isHeavyRunCommand(launch.command, settings);
		case 'setup':
			return true;
	}
}

/**
 * Classifies a run script's command, starting it outside the queue rather
 * than failing the launch if the classifier throws — the same fail-open
 * stance the shell gates take, since a script that will not start is worse
 * than one that skips the queue.
 * @param command - The run script's configured command.
 * @param settings - The live compute-queue settings.
 * @returns True when the command classifies heavy.
 */
function isHeavyRunCommand(
	command: string,
	settings: ComputeQueueSettings,
): boolean {
	try {
		return classifyHeavyCommandForSettings(command, settings).heavy;
	} catch (error) {
		console.warn('[scripts] Could not classify a run script command:', error);
		return false;
	}
}

/**
 * Identity of a waiting launch, so a second request for the same script joins
 * the first instead of queueing again.
 * @param launch - The resolved launch.
 * @returns The key it waits under.
 */
function queueKey(launch: ScriptLaunch): string {
	return `${launch.workspaceId}:${launch.kind}:${launch.scriptName ?? ''}`;
}

/**
 * Formats a thrown launch error for the job's output tail.
 * @param error - What the launch threw.
 * @returns A one-line description.
 */
function describeLaunchError(error: unknown): string {
	return `The script could not start: ${error instanceof Error ? error.message : String(error)}`;
}
