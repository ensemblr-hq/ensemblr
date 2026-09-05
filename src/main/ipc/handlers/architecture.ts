import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	ArchitectureFailureCode,
	GetArchitectureSnapshotResult,
	ScanArchitectureSnapshotResult,
} from '../../../shared/ipc/contracts/architecture';
import {
	type ArchitectureService,
	ArchitectureServiceError,
} from '../../architecture/index.ts';
import {
	getArchitectureSnapshotRequestSchema,
	scanArchitectureSnapshotRequestSchema,
} from '../request-schemas.ts';

/**
 * Narrows a thrown value to the typed envelope the renderer translates. The
 * renderer never supplies a filesystem path — it names a workspace id and main
 * resolves the directory — so the only failures reaching here are a workspace
 * that no longer exists and a scan that could not run.
 * @param error - Whatever was thrown
 * @param fallback - Code to report when the error is not one of ours
 * @returns The failure envelope
 */
function describeFailure(
	error: unknown,
	fallback: ArchitectureFailureCode,
): { code: ArchitectureFailureCode; message: string } {
	if (error instanceof ArchitectureServiceError) {
		return { code: error.code, message: error.message };
	}
	return {
		code: fallback,
		message: error instanceof Error ? error.message : String(error),
	};
}

/**
 * Registers the architecture-diagram IPC handlers: read a workspace's stored
 * snapshot, and seed one for a workspace that predates the create-time scan.
 * Both validate and delegate; the scan and its refusals live in the service.
 * @param architectureService - Service the handlers delegate to
 */
export function registerArchitectureHandlers({
	architectureService,
}: {
	architectureService: ArchitectureService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.getArchitectureSnapshot,
		async (_event, raw: unknown): Promise<GetArchitectureSnapshotResult> => {
			try {
				const request = getArchitectureSnapshotRequestSchema.parse(raw);
				return await architectureService.readDiagram({
					workspaceId: request.workspaceId,
				});
			} catch (error) {
				return {
					current: null,
					error: describeFailure(error, 'workspace-missing'),
					previous: null,
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.scanArchitectureSnapshot,
		async (_event, raw: unknown): Promise<ScanArchitectureSnapshotResult> => {
			try {
				const request = scanArchitectureSnapshotRequestSchema.parse(raw);
				return await architectureService.scanIfMissingAndRead({
					workspaceId: request.workspaceId,
				});
			} catch (error) {
				return {
					current: null,
					error: describeFailure(error, 'scan-failed'),
					previous: null,
					rebuilt: false,
				};
			}
		},
	);
}
