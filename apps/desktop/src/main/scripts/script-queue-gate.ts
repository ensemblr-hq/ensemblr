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
		start: () => Promise<CreateTerminalSessionResult>;
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
	 * Frees the slot of a launch that never produced a terminal: a spawn error
	 * counts as a failed job, a refusal such as a running-script conflict as a
	 * cancelled one.
	 * @param lease - The lease the launch held.
	 * @param result - What the launch answered.
	 */
	function settleUnlaunched(
		lease: ScriptLease,
		result: CreateTerminalSessionResult,
	): void {
		if (
			result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
		) {
			lease.release({ exitCode: null });
			return;
		}

		computeQueue.cancel(lease.jobId);
	}

	/**
	 * Runs a granted launch and ties its slot to the terminal it opens, releasing
	 * the slot with the terminal's exit code once it ends.
	 * @param lease - The granted lease.
	 * @param start - Performs the launch.
	 * @returns The launch's result.
	 */
	async function launchHolding(
		lease: ScriptLease,
		start: () => Promise<CreateTerminalSessionResult>,
	): Promise<CreateTerminalSessionResult> {
		let result: CreateTerminalSessionResult;

		try {
			result = await start();
		} catch (error) {
			lease.release({ exitCode: null });
			throw error;
		}

		const terminalId = result.session?.id;

		if (!terminalId) {
			settleUnlaunched(lease, result);
			return result;
		}

		lease.attachTerminal(terminalId);
		void terminalService.waitForExit(terminalId).then(() =>
			lease.release({
				exitCode:
					terminalService.getSnapshot(terminalId).session?.exitCode ?? null,
			}),
		);

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
		start: () => Promise<CreateTerminalSessionResult>,
	): void {
		queuedLaunches.set(key, entry);
		void lease.granted
			.then((outcome) => {
				if (queuedLaunches.get(key) === entry) {
					queuedLaunches.delete(key);
				}

				return outcome === 'granted' ? launchHolding(lease, start) : undefined;
			})
			.catch(() => {});
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
				workspaceId: launch.workspaceId,
			});
			const state = computeQueue.getJob(lease.jobId)?.state;

			if (state === 'running') {
				return launchHolding(lease, start);
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
			return classifyHeavyCommandForSettings(launch.command, settings).heavy;
		case 'setup':
			return true;
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
