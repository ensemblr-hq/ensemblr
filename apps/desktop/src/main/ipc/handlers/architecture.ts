import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	ArchitectureFailureCode,
	GetArchitectureSnapshotResult,
} from '../../../shared/ipc/contracts/architecture';
import {
	type ArchitectureService,
	ArchitectureServiceError,
} from '../../architecture/index.ts';
import { getArchitectureSnapshotRequestSchema } from '../request-schemas.ts';

/**
 * Narrows a thrown value to the typed envelope the renderer translates. The
 * renderer never supplies a filesystem path — it names a workspace id and main
 * resolves the directory — so a workspace that no longer exists is the only
 * failure that reaches here without a code of its own.
 * @param error - Whatever was thrown
 * @returns The failure envelope
 */
function describeFailure(error: unknown): {
	code: ArchitectureFailureCode;
	message: string;
} {
	if (error instanceof ArchitectureServiceError) {
		return { code: error.code, message: error.message };
	}
	return {
		code: 'workspace-missing',
		message: error instanceof Error ? error.message : String(error),
	};
}

/**
 * Registers the architecture-diagram IPC handler: read a workspace's stored
 * snapshot. It validates and delegates; the refusals live in the service. There
 * is no write channel — a diagram is only ever authored by an agent, over the
 * control server.
 * @param architectureService - Service the handler delegates to
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
					error: describeFailure(error),
					previous: null,
				};
			}
		},
	);
}
