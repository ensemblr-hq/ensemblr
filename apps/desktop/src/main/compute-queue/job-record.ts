import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import type { ComputeJobSnapshot } from '../../shared/compute-queue.ts';
import { isInside } from '../safe-fs/index.ts';
import type { ComputeJobResult } from './types.ts';

/**
 * The queue's private record of one job: the snapshot fields it reports plus
 * what scheduling and cancellation need. Records are replaced, never mutated.
 */
export interface JobRecord
	extends Omit<ComputeJobSnapshot, 'position' | 'workspaceName'> {
	/** Set once a cancel was asked of a running job; it ends as `cancelled`. */
	cancelRequested: boolean;
	/** Absolute working directory of a command job; null for scripts. */
	cwd: string | null;
	omittedChars: number;
	outputTail: string;
	rootSessionId: string | null;
	/** Monotonic enqueue order, the tiebreak every ordering uses. */
	sequence: number;
	/** Workspace root a command job runs in; null for scripts. */
	workspacePath: string | null;
}

/**
 * Projects a record onto the snapshot the renderer and agents see.
 * @param record - The job record.
 * @param position - One-based queue position, or null once out of the queue.
 * @param workspaceName - Display name of the job's workspace.
 * @returns The public snapshot.
 */
export function toJobSnapshot(
	record: JobRecord,
	position: number | null,
	workspaceName: string | null,
): ComputeJobSnapshot {
	return {
		command: record.command,
		endedAt: record.endedAt,
		enqueuedAt: record.enqueuedAt,
		exitCode: record.exitCode,
		id: record.id,
		initiator: record.initiator,
		kind: record.kind,
		label: record.label,
		logPath: record.logPath,
		position,
		sessionId: record.sessionId,
		signal: record.signal,
		startedAt: record.startedAt,
		state: record.state,
		terminalId: record.terminalId,
		workspaceId: record.workspaceId,
		workspaceName,
	};
}

/**
 * Extends a snapshot with the output and timings an agent acts on.
 * @param snapshot - The job's public snapshot.
 * @param output - The current or final cleaned output tail.
 * @returns The full job result.
 */
export function toJobResult(
	snapshot: ComputeJobSnapshot,
	output: { omittedChars: number; text: string },
): ComputeJobResult {
	const leftQueueAt = snapshot.startedAt ?? snapshot.endedAt;

	return {
		...snapshot,
		durationMs:
			snapshot.startedAt !== null && snapshot.endedAt !== null
				? snapshot.endedAt - snapshot.startedAt
				: null,
		omittedChars: output.omittedChars,
		outputTail: output.text,
		waitedMs: leftQueueAt === null ? null : leftQueueAt - snapshot.enqueuedAt,
	};
}

/**
 * Resolves a job's requested working directory against the workspace root,
 * refusing an absolute path and anything that lands outside the root either
 * lexically or once symlinks are resolved.
 * @param workspacePath - Absolute workspace root.
 * @param cwd - Requested directory relative to the root; empty means the root.
 * @returns The absolute directory to run in, or null when it is not an
 * existing directory inside the root.
 */
export function resolveJobCwd(
	workspacePath: string,
	cwd: string | undefined,
): string | null {
	const requested = cwd?.trim() ?? '';
	if (path.isAbsolute(requested)) {
		return null;
	}
	const candidate = path.resolve(workspacePath, requested);
	if (
		candidate !== path.resolve(workspacePath) &&
		!isInside(workspacePath, candidate)
	) {
		return null;
	}

	try {
		const rootReal = realpathSync.native(workspacePath);
		const candidateReal = realpathSync.native(candidate);
		const contained =
			candidateReal === rootReal || isInside(rootReal, candidateReal);
		return contained && statSync(candidateReal).isDirectory()
			? candidateReal
			: null;
	} catch {
		return null;
	}
}
