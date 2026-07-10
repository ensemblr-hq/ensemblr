import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	ListPiModelsResult,
	ListPiSessionEventsResult,
	ListPiSessionsResult,
	OpenPiSessionResult,
	PiSessionEventWire,
	StopPiSessionResult,
	SubmitPiPromptResult,
	WriteForkSummaryResult,
} from '../../../shared/ipc/contracts/pi-session';
import type { LocalCommandService } from '../../commands/local-command';
import type { PiSessionService } from '../../pi-agent';
import { snapshotToWire } from '../../pi-agent/pi-session-service.ts';
import type { PiExecutableService } from '../../pi-runtime';
import {
	presentPiModels,
	resolvePiProviderModels,
} from '../../pi-runtime/pi-provider-models.ts';
import type { WithPermissionGate } from '../permission-gate.ts';
import {
	listPiSessionEventsRequestSchema,
	listPiSessionsRequestSchema,
	openPiSessionRequestSchema,
	stopPiSessionRequestSchema,
	submitPiPromptRequestSchema,
	writeForkSummaryRequestSchema,
} from '../request-schemas.ts';

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
	withPermissionGate,
}: {
	localCommandService: LocalCommandService;
	piExecutableService: PiExecutableService;
	piSessionService: PiSessionService;
	withPermissionGate: WithPermissionGate;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.openPiSession,
		async (_event, raw: unknown): Promise<OpenPiSessionResult> => {
			try {
				const request = openPiSessionRequestSchema.parse(raw);
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
					resumeSessionId: request.resumeSessionId ?? null,
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
		async (_event, raw: unknown): Promise<SubmitPiPromptResult> => {
			try {
				const request = submitPiPromptRequestSchema.parse(raw);
				const acknowledgement = await piSessionService.submitPrompt({
					model: request.model ?? null,
					prompt: request.prompt,
					sessionId: request.sessionId,
					streamingBehavior: request.streamingBehavior,
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
		async (_event, raw: unknown): Promise<StopPiSessionResult> => {
			try {
				const request = stopPiSessionRequestSchema.parse(raw);
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
		async (_event, raw: unknown): Promise<ListPiSessionsResult> => {
			const request = listPiSessionsRequestSchema.parse(raw);
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
		(_event, raw: unknown): Promise<ListPiSessionEventsResult> => {
			const request = listPiSessionEventsRequestSchema.parse(raw);
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

	withPermissionGate(
		IPC_CHANNELS.writeForkSummary,
		'workspace-write',
		(_event, raw: unknown): Promise<WriteForkSummaryResult> => {
			const request = writeForkSummaryRequestSchema.parse(raw);
			return piSessionService.writeForkSummary(request);
		},
	);
}
