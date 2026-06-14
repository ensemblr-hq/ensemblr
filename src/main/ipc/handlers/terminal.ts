import { ipcMain } from 'electron';

import { type CreateTerminalSessionRequest, type CreateTerminalSessionResult, type KillTerminalRequest, type KillTerminalResult, type ListTerminalSessionsRequest, type ListTerminalSessionsResult, type ResizeTerminalRequest, type TerminalSnapshotRequest, type TerminalSnapshotResult, type WriteTerminalRequest } from '../../../shared/ipc/contracts/terminal';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { TerminalService } from '../../terminal';
import { TerminalServiceError } from '../../terminal';

/** Service dependencies used by the terminal IPC handlers. */
export interface TerminalHandlersOptions {
	terminalService: TerminalService;
}

/**
 * Registers the IPC handlers for PTY-backed terminal sessions: create, input,
 * resize, kill, list, and re-attach snapshot.
 * @param options - Required services.
 */
export function registerTerminalHandlers({
	terminalService,
}: TerminalHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.createTerminalSession,
		(
			_event,
			request: CreateTerminalSessionRequest,
		): Promise<CreateTerminalSessionResult> =>
			terminalService.create({
				cols: request.cols,
				command: request.command,
				kind: request.kind,
				rows: request.rows,
				title: request.title,
				workspaceId: request.workspaceId,
			}),
	);

	ipcMain.handle(
		IPC_CHANNELS.killTerminalSession,
		(_event, request: KillTerminalRequest): KillTerminalResult => {
			try {
				return {
					diagnostics: [],
					session: terminalService.kill(request.terminalId),
				};
			} catch (error) {
				if (error instanceof TerminalServiceError) {
					return {
						diagnostics: [
							{
								code: error.code,
								message: error.message,
								severity: 'error',
							},
						],
						session: null,
					};
				}

				throw error;
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listTerminalSessions,
		(
			_event,
			request: ListTerminalSessionsRequest,
		): ListTerminalSessionsResult => ({
			sessions: terminalService.list(request.workspaceId),
		}),
	);

	ipcMain.handle(
		IPC_CHANNELS.terminalSnapshot,
		(_event, request: TerminalSnapshotRequest): TerminalSnapshotResult =>
			terminalService.getSnapshot(request.terminalId),
	);

	ipcMain.handle(
		IPC_CHANNELS.resizeTerminalSession,
		(_event, request: ResizeTerminalRequest): void => {
			try {
				terminalService.resize(request.terminalId, request.cols, request.rows);
			} catch (error) {
				if (!(error instanceof TerminalServiceError)) {
					throw error;
				}
				// Resize of a vanished session is benign (tab closed mid-flight).
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.writeTerminalSession,
		(_event, request: WriteTerminalRequest): void => {
			try {
				terminalService.write(request.terminalId, request.data);
			} catch (error) {
				if (!(error instanceof TerminalServiceError)) {
					throw error;
				}
				// Writes to a vanished session are dropped silently.
			}
		},
	);
}
