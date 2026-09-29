import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	CheckpointFailure,
	CheckpointWire,
	ComputeTurnDiffResult,
	ListWorkspaceCheckpointsResult,
	RestoreCheckpointResult,
} from '../../../shared/ipc/contracts/checkpoint';
import {
	CheckpointServiceError,
	computeTurnDiff,
	listWorkspaceCheckpoints,
	restoreTurnCheckpoint,
} from '../../checkpoints/index.ts';
import type { EnsemblrDatabaseService } from '../../storage';
import { requireDatabase } from '../../storage/database.ts';
import {
	type CheckpointRow,
	getCheckpointByTurnId,
} from '../../storage/repositories/index.ts';
import { getWorkspacePathById } from '../../storage/repositories/workspace-repository.ts';
import {
	computeTurnDiffRequestSchema,
	listWorkspaceCheckpointsRequestSchema,
	restoreCheckpointRequestSchema,
} from '../request-schemas.ts';

/**
 * Registers IPC handlers for checkpoint listing, turn diff, and restore
 * (ADR 0012). Diff/restore resolve the workspace cwd from the checkpoint row
 * so the renderer never supplies filesystem paths. Turn ranges are resolved
 * against which sessions have a runtime right now, since a session row still
 * reading `streaming` after a crash describes a runtime that is gone.
 */
export function registerCheckpointHandlers({
	databaseService,
	isRuntimeOpen,
}: {
	databaseService: EnsemblrDatabaseService;
	isRuntimeOpen: (agentSessionId: string) => boolean;
}): void {
	const requireCheckpointDatabase = () =>
		requireDatabase(
			databaseService.getConnection()?.database,
			() => new Error('Database is not open; cannot access checkpoints.'),
		);

	ipcMain.handle(
		IPC_CHANNELS.listWorkspaceCheckpoints,
		async (_event, raw: unknown): Promise<ListWorkspaceCheckpointsResult> => {
			const request = listWorkspaceCheckpointsRequestSchema.parse(raw);
			const database = requireCheckpointDatabase();
			const checkpoints = listWorkspaceCheckpoints({
				database,
				isRuntimeOpen,
				workspaceId: request.workspaceId,
			});
			return {
				checkpoints: checkpoints.map(({ checkpoint, end }) => ({
					...toWire(checkpoint),
					end,
				})),
			};
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.computeTurnDiff,
		async (_event, raw: unknown): Promise<ComputeTurnDiffResult> => {
			const request = computeTurnDiffRequestSchema.parse(raw);
			const database = requireCheckpointDatabase();
			try {
				const cwd = resolveCwdForTurn({ database, turnId: request.turnId });
				const result = await computeTurnDiff({
					cwd,
					database,
					isRuntimeOpen,
					turnId: request.turnId,
				});
				return {
					checkpoint: toWire(result.checkpoint),
					files: result.files,
					ok: true,
					patch: result.patch,
				};
			} catch (error) {
				return { error: describeFailure(error, 'diff-failed'), ok: false };
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.restoreCheckpoint,
		async (_event, raw: unknown): Promise<RestoreCheckpointResult> => {
			const request = restoreCheckpointRequestSchema.parse(raw);
			const database = requireCheckpointDatabase();
			try {
				const cwd = resolveCwdForTurn({ database, turnId: request.turnId });
				const result = await restoreTurnCheckpoint({
					cwd,
					database,
					turnId: request.turnId,
				});
				return { checkpoint: toWire(result.checkpoint), ok: true };
			} catch (error) {
				return { error: describeFailure(error, 'restore-failed'), ok: false };
			}
		},
	);
}

/**
 * Resolve the workspace directory for a turn from its checkpoint row, so the
 * renderer never supplies filesystem paths.
 * @param database - Open database connection
 * @param turnId - Turn whose workspace path to resolve
 * @returns The absolute workspace directory for the turn's checkpoint
 */
function resolveCwdForTurn({
	database,
	turnId,
}: {
	database: ReturnType<typeof requireDatabase>;
	turnId: string;
}): string {
	const checkpoint = getCheckpointByTurnId({ database, turnId });
	if (!checkpoint) {
		throw new CheckpointServiceError({
			code: 'no-checkpoint',
			message: `No checkpoint was captured for turn ${turnId}.`,
		});
	}
	const cwd = getWorkspacePathById({
		database,
		workspaceId: checkpoint.workspaceId,
	});
	if (!cwd) {
		throw new CheckpointServiceError({
			code: 'workspace-missing',
			message: 'The workspace for this checkpoint no longer exists.',
		});
	}
	return cwd;
}

/**
 * Convert a thrown error into a structured checkpoint failure for the renderer.
 * @param error - The caught error
 * @param fallback - Failure code to use when the error is not a service error
 * @returns The structured checkpoint failure
 */
function describeFailure(
	error: unknown,
	fallback: 'diff-failed' | 'restore-failed',
): CheckpointFailure {
	if (error instanceof CheckpointServiceError) {
		return { code: error.code, message: error.message };
	}
	return {
		code: fallback,
		message: error instanceof Error ? error.message : 'Unknown error',
	};
}

/**
 * Map a checkpoint database row to its renderer-facing wire shape.
 * @param row - The stored checkpoint row
 * @returns The checkpoint in wire form
 */
function toWire(row: CheckpointRow): CheckpointWire {
	return {
		createdAt: row.createdAt,
		gitHash: row.gitHash,
		gitRef: row.gitRef,
		id: row.id,
		label: row.label,
		agentSessionId: row.agentSessionId,
		turnId: row.turnId,
		workspaceId: row.workspaceId,
	};
}
