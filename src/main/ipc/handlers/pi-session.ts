import { ipcMain } from 'electron';

import {
	IPC_CHANNELS,
	type ListPiModelsResult,
	type ListPiSessionEventsRequest,
	type ListPiSessionEventsResult,
	type ListPiSessionsRequest,
	type ListPiSessionsResult,
	type OpenPiSessionRequest,
	type OpenPiSessionResult,
	type PiSessionEventWire,
	type StopPiSessionRequest,
	type StopPiSessionResult,
	type SubmitPiPromptRequest,
	type SubmitPiPromptResult,
} from '../../../shared/ipc';
import type { LocalCommandService } from '../../commands/local-command';
import {
	type PiSessionService,
	snapshotToWire,
} from '../../pi-agent/pi-session-service.ts';
import type { PiExecutableService } from '../../pi-runtime';
import {
	presentPiModels,
	resolvePiProviderModels,
} from '../../pi-runtime/pi-provider-models.ts';

/** Service dependencies used by the Pi session IPC handlers. */
export interface PiSessionHandlersOptions {
	localCommandService: LocalCommandService;
	piExecutableService: PiExecutableService;
	piSessionService: PiSessionService;
}

const EMPTY_PI_MODELS: ListPiModelsResult = {
	defaultModelId: null,
	defaultThinkingLevel: null,
	models: [],
};

/**
 * Registers IPC handlers that expose the Pi session service to the renderer.
 * @param options - Required services.
 */
export function registerPiSessionHandlers({
	localCommandService,
	piExecutableService,
	piSessionService,
}: PiSessionHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.openPiSession,
		async (
			_event,
			request: OpenPiSessionRequest,
		): Promise<OpenPiSessionResult> => {
			try {
				const executable = await piExecutableService.getSnapshot();
				if (executable.status === 'error' || !executable.command) {
					return {
						error: 'Pi executable is not ready. Resolve setup checks first.',
					};
				}
				if (!request.workspaceCwd.trim()) {
					return { error: 'workspaceCwd is required.' };
				}
				const snapshot = await piSessionService.openSession({
					chatTabId: request.chatTabId ?? null,
					executable,
					initialPrompt: request.initialPrompt ?? null,
					label: request.label,
					model: request.model ?? null,
					thinkingLevel: request.thinkingLevel ?? null,
					workspaceCwd: request.workspaceCwd,
					workspaceId: request.workspaceId,
				});
				return { session: snapshotToWire(snapshot) };
			} catch (cause) {
				return {
					error:
						cause instanceof Error
							? cause.message
							: 'Failed to open Pi session.',
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.submitPiPrompt,
		async (
			_event,
			request: SubmitPiPromptRequest,
		): Promise<SubmitPiPromptResult> => {
			try {
				const acknowledgement = await piSessionService.submitPrompt({
					model: request.model ?? null,
					prompt: request.prompt,
					sessionId: request.sessionId,
					thinkingLevel: request.thinkingLevel ?? null,
				});
				return acknowledgement;
			} catch (cause) {
				return {
					error: cause instanceof Error ? cause.message : 'Submit failed.',
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.stopPiSession,
		async (
			_event,
			request: StopPiSessionRequest,
		): Promise<StopPiSessionResult> => {
			try {
				await piSessionService.stopSession(request);
				return { ok: true };
			} catch (cause) {
				return {
					error: cause instanceof Error ? cause.message : 'Stop failed.',
					ok: false,
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listPiSessions,
		async (
			_event,
			request: ListPiSessionsRequest,
		): Promise<ListPiSessionsResult> => {
			const sessions = piSessionService.listSessionsForWorkspace(
				request.workspaceId,
			);
			return {
				sessions: sessions.map(snapshotToWire),
			};
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listPiModels,
		async (): Promise<ListPiModelsResult> => {
			try {
				const executable = await piExecutableService.getSnapshot();
				const snapshot = await resolvePiProviderModels({
					executable,
					localCommandService,
				});
				return presentPiModels(snapshot);
			} catch {
				return EMPTY_PI_MODELS;
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listPiSessionEvents,
		(
			_event,
			request: ListPiSessionEventsRequest,
		): Promise<ListPiSessionEventsResult> => {
			const rows = piSessionService.listEvents(request.branchId);
			const events: PiSessionEventWire[] = rows.map((row) => ({
				branchId: row.branchId,
				createdAt: row.createdAt,
				eventType: row.eventType,
				id: row.id,
				ordinal: row.ordinal,
				payload: row.payload,
				stream: row.stream,
				turnId: row.turnId,
			}));
			return Promise.resolve({ events });
		},
	);
}
