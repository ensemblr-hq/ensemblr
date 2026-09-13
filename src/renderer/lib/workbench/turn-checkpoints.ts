import type { CheckpointWire } from '@/shared/ipc/contracts/checkpoint';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/** A turn's checkpoint resolved to the diff scope covering what that turn changed. */
export interface TurnCheckpointScope {
	label: string;
	scope: Extract<WorkspaceGitDiffScope, { kind: 'turn' }>;
	turnId: string;
}

/**
 * Pairs each checkpoint with the one captured after it, since a checkpoint is
 * taken *before* a prompt: turn N's changes are the diff from its own
 * checkpoint to turn N+1's. The newest turn has no checkpoint after it, so its
 * scope leaves `toRef` unset and diffs against the live working tree instead.
 * @param checkpoints - A session's or workspace's checkpoints, oldest first
 * @returns One scope per checkpointed turn, keyed by turn id
 */
export function turnCheckpointScopes(
	checkpoints: readonly CheckpointWire[],
): ReadonlyMap<string, TurnCheckpointScope> {
	const captured = checkpoints.filter(
		(checkpoint) => checkpoint.turnId !== null && checkpoint.gitHash !== null,
	);
	const scopes = new Map<string, TurnCheckpointScope>();
	for (const [index, checkpoint] of captured.entries()) {
		const turnId = checkpoint.turnId;
		const fromRef = checkpoint.gitHash;
		if (turnId === null || fromRef === null) {
			continue;
		}
		const toRef = captured[index + 1]?.gitHash ?? null;
		scopes.set(turnId, {
			label: checkpoint.label,
			scope: {
				fromRef,
				kind: 'turn',
				...(toRef === null ? {} : { toRef }),
			},
			turnId,
		});
	}
	return scopes;
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
