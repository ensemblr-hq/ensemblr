import { ipcMain } from 'electron';

import {
	IPC_CHANNELS,
	type ListPiModelsResult,
	type ListPiSessionsRequest,
	type ListPiSessionsResult,
	type OpenPiSessionRequest,
	type OpenPiSessionResult,
	type PiChatTabWire,
	type PiSessionSnapshotWire,
	type StopPiSessionRequest,
	type StopPiSessionResult,
	type SubmitPiPromptRequest,
	type SubmitPiPromptResult,
} from '../../../shared/ipc';
import type { PiExecutableService } from '../../pi';
import type {
	PiSessionService,
	PiSessionSnapshot,
} from '../../pi-agent/pi-session-service.ts';

/** Service dependencies used by the Pi session IPC handlers. */
export interface PiSessionHandlersOptions {
	piExecutableService: PiExecutableService;
	piSessionService: PiSessionService;
}

/** Static placeholder model catalog — replaced when capability discovery (THE-135) lands. */
const STATIC_PI_MODELS: ListPiModelsResult = {
	defaultModelId: 'gpt-5.5',
	defaultThinkingLevel: 'high',
	models: [
		{
			displayName: 'GPT-5.5 via Pi',
			id: 'gpt-5.5',
			provider: 'pi',
			thinkingLevels: ['low', 'medium', 'high'],
		},
		{
			displayName: 'GPT-5.5 Mini',
			id: 'gpt-5.5-mini',
			provider: 'pi',
			thinkingLevels: ['low', 'medium'],
		},
	],
};

/**
 * Registers IPC handlers that expose the Pi session service to the renderer.
 * @param options - Required services.
 */
export function registerPiSessionHandlers({
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

	ipcMain.handle(IPC_CHANNELS.listPiModels, (): Promise<ListPiModelsResult> => {
		return Promise.resolve(STATIC_PI_MODELS);
	});
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
