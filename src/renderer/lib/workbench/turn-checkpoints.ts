import type { CheckpointWire } from '@/shared/ipc/contracts/checkpoint';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/** A turn's checkpoint resolved to the diff scope covering what that turn changed. */
export interface TurnCheckpointScope {
	label: string;
	scope: Extract<WorkspaceGitDiffScope, { kind: 'turn' }>;
	turnId: string;
}

/**
 * How a session's last turn is bounded. Everything before it pairs with the
 * next checkpoint in the same session, which needs nothing extra.
 */
interface TailBound {
	/** True while the session is mid-turn, which keeps its last turn live. */
	isStreaming?: boolean;
	/** Every checkpoint in the workspace, oldest first, across all sessions. */
	workspaceCheckpoints?: readonly CheckpointWire[];
}

/**
 * Pairs each checkpoint with the one captured after it, since a checkpoint is
 * taken *before* a prompt: turn N's changes are the diff from its own
 * checkpoint to turn N+1's. The last turn has none after it in its own session,
 * so it runs to the next prompt taken anywhere in the workspace — and only when
 * the workspace has had none either does it stay live against the working tree.
 *
 * Without that wider bound a chat the user finished last week keeps diffing the
 * live tree, so opening it reports every change every other chat has made
 * since as that turn's work. A session that is still mid-turn is exempt:
 * bounding a turn that is still writing would drop whatever it writes next.
 * @param checkpoints - One session's checkpoints, oldest first
 * @param tail - How to bound the last turn; omitted leaves it live
 * @returns One scope per checkpointed turn, keyed by turn id
 */
export function turnCheckpointScopes(
	checkpoints: readonly CheckpointWire[],
	tail: TailBound = {},
): ReadonlyMap<string, TurnCheckpointScope> {
	const captured = capturedCheckpoints(checkpoints);
	const scopes = new Map<string, TurnCheckpointScope>();
	for (const [index, checkpoint] of captured.entries()) {
		const turnId = checkpoint.turnId;
		const fromRef = checkpoint.gitHash;
		if (turnId === null || fromRef === null) {
			continue;
		}
		const toRef =
			captured[index + 1]?.gitHash ?? nextInWorkspace(checkpoint, tail);
		scopes.set(turnId, {
			label: checkpoint.label,
			scope: {
				fromRef,
				kind: 'turn',
				...(toRef ? { toRef } : {}),
			},
			turnId,
		});
	}
	return scopes;
}

/** Checkpoints whose capture actually produced a commit to diff against. */
function capturedCheckpoints(
	checkpoints: readonly CheckpointWire[],
): readonly CheckpointWire[] {
	return checkpoints.filter(
		(checkpoint) => checkpoint.turnId !== null && checkpoint.gitHash !== null,
	);
}

/**
 * The first checkpoint the workspace captured after this one, whichever chat
 * took it. Backs the bound on a settled session's last turn.
 * @param checkpoint - The session's last captured checkpoint
 * @param tail - The workspace's checkpoints and whether the session is live
 * @returns The bounding commit, or null to leave the turn against the working tree
 */
function nextInWorkspace(
	checkpoint: CheckpointWire,
	{ isStreaming, workspaceCheckpoints }: TailBound,
): string | null {
	if (isStreaming || !workspaceCheckpoints) {
		return null;
	}
	const captured = workspaceCheckpoints.filter((entry) => entry.gitHash !== null);
}

/**
 * The newest checkpointed turn, whose scope runs to the live working tree.
 * @param checkpoints - Checkpoints, oldest first
 * @returns The latest turn's scope, or null when nothing was ever captured
 */
export function latestTurnCheckpointScope(
	checkpoints: readonly CheckpointWire[],
): TurnCheckpointScope | null {
	const scopes = [...turnCheckpointScopes(checkpoints).values()];
	return scopes.at(-1) ?? null;
}
