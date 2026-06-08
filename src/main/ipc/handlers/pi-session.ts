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
	type PiChatTabWire,
	type PiModelOptionWire,
	type PiSessionEventWire,
	type PiSessionSnapshotWire,
	type StopPiSessionRequest,
	type StopPiSessionResult,
	type SubmitPiPromptRequest,
	type SubmitPiPromptResult,
} from '../../../shared/ipc';
import type { LocalCommandService } from '../../commands/local-command';
import type { PiExecutableService } from '../../pi';
import { resolvePiProviderModels } from '../../pi/pi-provider-models.ts';
import type {
	PiSessionService,
	PiSessionSnapshot,
} from '../../pi-agent/pi-session-service.ts';

/** Service dependencies used by the Pi session IPC handlers. */
export interface PiSessionHandlersOptions {
	localCommandService: LocalCommandService;
	piExecutableService: PiExecutableService;
	piSessionService: PiSessionService;
}

const DEFAULT_THINKING_LEVELS = ['low', 'medium', 'high'] as const;
const DEFAULT_THINKING_LEVEL = 'medium';

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
					executable,
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
				if (snapshot.status !== 'success' || snapshot.models.length === 0) {
					return EMPTY_PI_MODELS;
				}
				const models: PiModelOptionWire[] = snapshot.models.map((row) => ({
					displayName: `${row.model} (${row.provider})`,
					id: row.id,
					provider: row.provider,
					thinkingLevels: DEFAULT_THINKING_LEVELS,
				}));
				return {
					defaultModelId: models[0]?.id ?? null,
					defaultThinkingLevel: DEFAULT_THINKING_LEVEL,
					models,
				};
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

function snapshotToWire(snapshot: PiSessionSnapshot): PiSessionSnapshotWire {
	const tabs: PiChatTabWire[] = snapshot.openedTabs.map((tab) => ({
		id: tab.id,
		kind: tab.kind,
		openedAt: tab.openedAt,
		piSessionId: tab.piSessionId,
		position: tab.position,
		title: tab.title,
		workspaceId: tab.workspaceId,
	}));
	return {
		branchId: snapshot.branchId,
		closedAt: snapshot.row.closedAt,
		createdAt: snapshot.row.createdAt,
		cwd: snapshot.row.cwd,
		id: snapshot.row.id,
		label: snapshot.row.label,
		model: snapshot.row.model,
		openedTabs: tabs,
		piSessionId: snapshot.row.piSessionId,
		status: snapshot.row.status,
		thinkingLevel: snapshot.row.thinkingLevel,
		updatedAt: snapshot.row.updatedAt,
		workspaceId: snapshot.row.workspaceId,
	};
}
