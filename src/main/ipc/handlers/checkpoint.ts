import { ipcMain } from 'electron';

import { type CheckpointFailure, type CheckpointWire, type ComputeTurnDiffResult, type ListTurnCheckpointsResult, type RestoreCheckpointResult } from '../../../shared/ipc/contracts/checkpoint';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import {
	CheckpointServiceError,
	computeTurnDiff,
	listTurnCheckpoints,
	restoreTurnCheckpoint,
} from '../../checkpoints/checkpoint-service.ts';
import {
	type EnsembleDatabaseService,
	requireDatabase,
} from '../../storage/database.ts';
import {
	type CheckpointRow,
	getCheckpointByTurnId,
} from '../../storage/repositories/checkpoint-repository.ts';
import { getWorkspacePathById } from '../../storage/repositories/workspace-repository.ts';
import {
	computeTurnDiffRequestSchema,
	listTurnCheckpointsRequestSchema,
	restoreCheckpointRequestSchema,
} from '../request-schemas.ts';

export interface CheckpointHandlersOptions {
	databaseService: EnsembleDatabaseService;
}

/**
 * Registers IPC handlers for checkpoint listing, turn diff, and restore
 * (ADR 0012). Diff/restore resolve the workspace cwd from the checkpoint row
 * so the renderer never supplies filesystem paths.
 */
export function registerCheckpointHandlers({
	databaseService,
}: CheckpointHandlersOptions): void {
	const requireCheckpointDatabase = () =>
		requireDatabase(
			databaseService.getConnection()?.database,
			() => new Error('Database is not open; cannot access checkpoints.'),
		);

	ipcMain.handle(
		IPC_CHANNELS.listTurnCheckpoints,
		async (_event, raw: unknown): Promise<ListTurnCheckpointsResult> => {
			const request = listTurnCheckpointsRequestSchema.parse(raw);
			const database = requireCheckpointDatabase();
			const checkpoints = listTurnCheckpoints({
				database,
				piSessionId: request.piSessionId,
			});
			return { checkpoints: checkpoints.map(toWire) };
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

function toWire(row: CheckpointRow): CheckpointWire {
	return {
		createdAt: row.createdAt,
		gitHash: row.gitHash,
		gitRef: row.gitRef,
		id: row.id,
		label: row.label,
		piSessionId: row.piSessionId,
		turnId: row.turnId,
		workspaceId: row.workspaceId,
	};
}
