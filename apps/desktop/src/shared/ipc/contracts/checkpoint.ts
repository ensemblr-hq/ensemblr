/**
 * Wire contracts for git-backed checkpoint IPC (ADR 0012): per-turn checkpoint
 * listing, turn diff computation, and workspace restore.
 */

import type { TurnDiffEnd } from '../../turn-diff-range.ts';

/** Renderer-facing snapshot of a checkpoint row. */
export interface CheckpointWire {
	agentSessionId: string | null;
	createdAt: string;
	gitHash: string | null;
	gitRef: string;
	id: string;
	label: string;
	turnId: string | null;
	workspaceId: string;
}

/** A turn's checkpoint with where main resolved that turn's changes to end. */
export interface TurnCheckpointWire extends CheckpointWire {
	end: TurnDiffEnd;
}

/**
 * List every checkpoint captured in a workspace, oldest first, across all of
 * its agent sessions. The chat timelines read their turns' ranges from it, and
 * the Changes panel reads "the latest turn" — the newest checkpoint in the
 * workspace, whichever chat produced it.
 */
export interface ListWorkspaceCheckpointsRequest {
	workspaceId: string;
}

/** Result of listing a workspace's checkpoints, oldest capture first. */
export interface ListWorkspaceCheckpointsResult {
	checkpoints: readonly TurnCheckpointWire[];
}

/**
 * Pushed after a checkpoint is captured, so every window re-reads the turn
 * ranges it closes. Without it the turn before a running prompt keeps reading
 * as the newest and diffs the live tree the running prompt is writing to.
 */
export interface CheckpointsChangedBroadcast {
	workspaceId: string;
}

/** One changed file in a turn diff. */
export interface TurnDiffFileWire {
	/** Added line count; null for binary files. */
	additions: number | null;
	/** Deleted line count; null for binary files. */
	deletions: number | null;
	path: string;
	status: 'added' | 'deleted' | 'modified' | 'renamed';
}

/** Reason a checkpoint diff or restore operation failed. */
export type CheckpointFailureCode =
	| 'diff-failed'
	| 'no-checkpoint'
	| 'range-unknown'
	| 'restore-failed'
	| 'workspace-missing';

/** A failed checkpoint operation, with its code and message. */
export interface CheckpointFailure {
	code: CheckpointFailureCode;
	message: string;
}

/**
 * Diff between a turn's pre-prompt checkpoint and where the turn ends: the
 * checkpoint that closes it, or the live working tree while it is the newest.
 */
export interface ComputeTurnDiffRequest {
	turnId: string;
}

/** Result of computing a turn diff: the checkpoint, changed files, and patch on success, or a failure. */
export type ComputeTurnDiffResult =
	| {
			checkpoint: CheckpointWire;
			files: readonly TurnDiffFileWire[];
			ok: true;
			patch: string;
	  }
	| { error: CheckpointFailure; ok: false };

/**
 * Restore workspace files to a turn's pre-prompt checkpoint. Non-destructive
 * to agent session files; later Ensemblr-visible events are hidden, not deleted.
 */
export interface RestoreCheckpointRequest {
	/**
	 * Explicit destructive-action acknowledgment. The restore overwrites
	 * tracked files modified after the checkpoint; the main process refuses
	 * requests without it, so the renderer must confirm with the user first.
	 */
	confirm: true;
	turnId: string;
}

/** Result of restoring a workspace to a turn's checkpoint: the restored checkpoint on success, or a failure. */
export type RestoreCheckpointResult =
	| { checkpoint: CheckpointWire; ok: true }
	| { error: CheckpointFailure; ok: false };

/** Checkpoint IPC surface — list / diff / restore, plus the capture push. */
export interface CheckpointApi {
	computeTurnDiff: (
		request: ComputeTurnDiffRequest,
	) => Promise<ComputeTurnDiffResult>;
	listWorkspaceCheckpoints: (
		request: ListWorkspaceCheckpointsRequest,
	) => Promise<ListWorkspaceCheckpointsResult>;
	onCheckpointsChanged: (
		listener: (broadcast: CheckpointsChangedBroadcast) => void,
	) => () => void;
	restoreCheckpoint: (
		request: RestoreCheckpointRequest,
	) => Promise<RestoreCheckpointResult>;
}
