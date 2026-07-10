/**
 * Wire contracts for git-backed checkpoint IPC (ADR 0012): per-turn checkpoint
 * listing, turn diff computation, and workspace restore.
 */

/** Renderer-facing snapshot of a checkpoint row. */
export interface CheckpointWire {
	createdAt: string;
	gitHash: string | null;
	gitRef: string;
	id: string;
	label: string;
	piSessionId: string | null;
	turnId: string | null;
	workspaceId: string;
}

/** List checkpoints captured for a Pi session, oldest first. */
export interface ListTurnCheckpointsRequest {
	piSessionId: string;
}

/** Result of listing a Pi session's checkpoints. */
export interface ListTurnCheckpointsResult {
	checkpoints: readonly CheckpointWire[];
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
	| 'restore-failed'
	| 'workspace-missing';

/** A failed checkpoint operation, with its code and message. */
export interface CheckpointFailure {
	code: CheckpointFailureCode;
	message: string;
}

/**
 * Diff between a turn's pre-prompt checkpoint and the post-turn state (the
 * next checkpoint when one exists, otherwise the live working tree).
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
 * to Pi session files; later Ensemblr-visible events are hidden, not deleted.
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

/** Checkpoint IPC surface — list / diff / restore. */
export interface CheckpointApi {
	computeTurnDiff: (
		request: ComputeTurnDiffRequest,
	) => Promise<ComputeTurnDiffResult>;
	listTurnCheckpoints: (
		request: ListTurnCheckpointsRequest,
	) => Promise<ListTurnCheckpointsResult>;
	restoreCheckpoint: (
		request: RestoreCheckpointRequest,
	) => Promise<RestoreCheckpointResult>;
}
