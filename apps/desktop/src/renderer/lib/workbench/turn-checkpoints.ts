import type { UIMessage } from 'ai';

import { turnMetadataOf } from '@/renderer/lib/agent-timeline';
import type { TurnCheckpointWire } from '@/shared/ipc/contracts/checkpoint';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/** The diff scope covering what one agent turn changed. */
type TurnDiffScope = Extract<WorkspaceGitDiffScope, { kind: 'turn' }>;

/** A turn's checkpoint resolved to the diff scope covering what that turn changed. */
export interface TurnCheckpointScope {
	label: string;
	/**
	 * What the turn changed, or null when main could not close its range — a
	 * later turn captured no checkpoint. Restoring still works, since that only
	 * needs the checkpoint the turn opened with.
	 */
	scope: TurnDiffScope | null;
	turnId: string;
}

/** A listed checkpoint whose capture produced a commit for a known turn. */
type CapturedTurnCheckpoint = TurnCheckpointWire & {
	gitHash: string;
	turnId: string;
};

/**
 * Keys each captured turn's diff scope by turn id. Where a turn ends is main's
 * call (`resolveTurnDiffEnds`), so this only translates that answer into the
 * scope the chips, the diff tabs, and the Changes panel read.
 * @param checkpoints - A workspace's checkpoints, oldest first
 * @returns One scope per captured turn, in capture order
 */
export function turnCheckpointScopes(
	checkpoints: readonly TurnCheckpointWire[],
): ReadonlyMap<string, TurnCheckpointScope> {
	return new Map(
		checkpoints.filter(isCapturedTurnCheckpoint).map((checkpoint) => [
			checkpoint.turnId,
			{
				label: checkpoint.label,
				scope: turnScopeOf(checkpoint),
				turnId: checkpoint.turnId,
			},
		]),
	);
}

/**
 * The newest checkpointed turn in the workspace, whichever chat ran it.
 * @param checkpoints - Checkpoints, oldest first
 * @returns The latest turn's scope, or null when nothing was ever captured
 */
export function latestTurnCheckpointScope(
	checkpoints: readonly TurnCheckpointWire[],
): TurnCheckpointScope | null {
	const scopes = [...turnCheckpointScopes(checkpoints).values()];
	return scopes.at(-1) ?? null;
}

/**
 * Re-reads a turn scope a diff tab stored when it opened. A tab opened while its
 * turn was running stored it running to the working tree, and one opened in the
 * moment Claude paused between queued inputs stored an end that turn later
 * moved past — so every turn scope is looked up again by the checkpoint it
 * starts from, and takes that turn's current end.
 *
 * When the turn's end was lost, a scope that still runs to the working tree is
 * withheld, the same as every other surface withholds that range: diffing on
 * would report later work as this turn's. A scope already closed keeps the end
 * it had, and any other scope passes through.
 * @param scope - The scope a diff tab carries
 * @param checkpoints - The workspace's current checkpoints
 * @returns The scope with the turn's current end, or null when it is withheld
 */
export function currentTurnScope(
	scope: WorkspaceGitDiffScope | undefined,
	checkpoints: readonly TurnCheckpointWire[],
): WorkspaceGitDiffScope | undefined | null {
	if (scope?.kind !== 'turn') {
		return scope;
	}
	const checkpoint = checkpoints.find(
		(entry): entry is CapturedTurnCheckpoint =>
			isCapturedTurnCheckpoint(entry) && entry.gitHash === scope.fromRef,
	);
	if (!checkpoint) {
		return scope;
	}
	const current = turnScopeOf(checkpoint);
	if (!current) {
		return scope.toRef === undefined ? null : scope;
	}
	return isSameTurnScope(current, scope) ? scope : current;
}

/**
 * Whether two turn scopes cover the same range, so a re-read that changed
 * nothing hands back the caller's own object.
 * @param left - First scope
 * @param right - Second scope
 * @returns True when both start and end match
 */
function isSameTurnScope(left: TurnDiffScope, right: TurnDiffScope): boolean {
	return left.fromRef === right.fromRef && left.toRef === right.toRef;
}

/**
 * Which assistant row of each turn carries that turn's checkpoint actions.
 *
 * Each input opens its own turn, but one turn can still render as several
 * assistant rows: turns recorded before steers opened turns of their own, and
 * any row the transcript splits without a new input. The turn's diff covers
 * every row, so it belongs to the last — an earlier row's footer would
 * otherwise list files written after it. The restore point is where the turn
 * began, so that stays on the first row.
 * @param messages - The timeline's mapped messages, oldest first
 * @returns The ids of the rows that own each action
 */
export function turnActionOwners(messages: readonly UIMessage[]): {
	diffOwnerIds: ReadonlySet<string>;
	restoreOwnerIds: ReadonlySet<string>;
} {
	const firstByTurn = new Map<string, string>();
	const lastByTurn = new Map<string, string>();
	for (const message of messages) {
		const turnId =
			message.role === 'assistant' ? turnMetadataOf(message)?.turnId : null;
		if (!turnId) {
			continue;
		}
		if (!firstByTurn.has(turnId)) {
			firstByTurn.set(turnId, message.id);
		}
		lastByTurn.set(turnId, message.id);
	}
	return {
		diffOwnerIds: new Set(lastByTurn.values()),
		restoreOwnerIds: new Set(firstByTurn.values()),
	};
}

/**
 * The diff scope a captured checkpoint's turn covers.
 * @param checkpoint - A checkpoint with a commit and a turn
 * @returns The turn's scope, or null when its end is unknown
 */
function turnScopeOf(checkpoint: CapturedTurnCheckpoint): TurnDiffScope | null {
	switch (checkpoint.end.kind) {
		case 'checkpoint':
			return {
				fromRef: checkpoint.gitHash,
				kind: 'turn',
				toRef: checkpoint.end.gitHash,
			};
		case 'working-tree':
			return { fromRef: checkpoint.gitHash, kind: 'turn' };
		case 'unknown':
			return null;
	}
}

/**
 * Whether a listed checkpoint belongs to a turn and produced a commit to diff from.
 * @param checkpoint - A listed checkpoint
 * @returns True when the checkpoint can open a turn range
 */
function isCapturedTurnCheckpoint(
	checkpoint: TurnCheckpointWire,
): checkpoint is CapturedTurnCheckpoint {
	return checkpoint.turnId !== null && checkpoint.gitHash !== null;
}
