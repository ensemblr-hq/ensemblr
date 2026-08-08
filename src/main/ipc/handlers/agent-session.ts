import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { AgentModelCatalog } from '../../../shared/ipc/contracts/agent-models';
import type {
	AgentSessionEventWire,
	ListAgentSessionEventsResult,
	ListAgentSessionsResult,
	OpenAgentSessionResult,
	StopAgentSessionResult,
	SubmitAgentPromptResult,
	WriteForkSummaryResult,
} from '../../../shared/ipc/contracts/agent-session';
import type { AgentModelCatalogService } from '../../agent-providers';
import {
	type AgentSessionService,
	snapshotToWire,
} from '../../agent-runtime/agent-session-service.ts';
import type { PiExecutableService } from '../../pi-runtime';
import { isBlockedByPiExecutable } from '../../pi-runtime/pi-executable-gate.ts';
import type { PlanModeRegistry } from '../../plan-mode';
import type { WithPermissionGate } from '../permission-gate.ts';
import {
	listAgentSessionEventsRequestSchema,
	listAgentSessionsRequestSchema,
	openAgentSessionRequestSchema,
	stopAgentSessionRequestSchema,
	submitAgentPromptRequestSchema,
	writeForkSummaryRequestSchema,
} from '../request-schemas.ts';

/**
 * Registers IPC handlers that expose the agent session service to the renderer.
 * @param options - Required services.
 */
export function registerAgentSessionHandlers({
	agentModelCatalog,
	agentSessionService,
	piExecutableService,
	planModeRegistry,
	withPermissionGate,
}: {
	/**
	 * Every runtime's models plus the model→runtime lookup. Shared with the
	 * agent-control spawn path so a delegated child and a user-opened chat resolve
	 * a model id to the same runtime.
	 */
	agentModelCatalog: AgentModelCatalogService;
	agentSessionService: AgentSessionService;
	piExecutableService: PiExecutableService;
	/**
	 * Mirror of the renderer's per-chat Plan Mode toggle. Set here rather than
	 * inside the session service: the renderer's setting is the durable record of
	 * what the user chose and rides every open and submit, so the runtime never
	 * needs to persist it. An absent `planMode` means the user has no opinion about
	 * this tab, not that it is off — a spawned child inherits Plan Mode through the
	 * control layer, and clearing that from a request which never mentioned it
	 * would unblock a conversation nobody asked to unblock.
	 */
	planModeRegistry: PlanModeRegistry;
	withPermissionGate: WithPermissionGate;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.openAgentSession,
		async (_event, raw: unknown): Promise<OpenAgentSessionResult> => {
			try {
				const request = openAgentSessionRequestSchema.parse(raw);
				// Derived here rather than accepted off the wire: the renderer sends a
				// model id, and only the main process's own catalog decides which
				// runtime owns it, so a stale window cannot cross providers.
				const provider = await agentModelCatalog.resolveAgentProvider(
					request.model,
				);
				const executable = await piExecutableService.getSnapshot();
				if (isBlockedByPiExecutable({ executable, provider })) {
					return {
						error: 'Pi executable is not ready. Resolve setup checks first.',
					};
				}
				if (!request.workspaceCwd.trim()) {
					return { error: 'workspaceCwd is required.' };
				}
				const snapshot = await agentSessionService.openSession({
					chatTabId: request.chatTabId ?? null,
					executable,
					initialPrompt: request.initialPrompt ?? null,
					label: request.label,
					model: request.model ?? null,
					planMode: request.planMode,
					...(provider ? { provider } : {}),
					resumeSessionId: request.resumeSessionId ?? null,
					thinkingLevel: request.thinkingLevel ?? null,
					workspaceCwd: request.workspaceCwd,
					workspaceId: request.workspaceId,
				});
				if (request.planMode !== undefined) {
					planModeRegistry.setActive(snapshot.id, request.planMode);
				}
				return { session: snapshotToWire(snapshot) };
			} catch (cause) {
				return {
					error:
						cause instanceof Error
							? cause.message
							: 'Failed to open agent session.',
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.submitAgentPrompt,
		async (_event, raw: unknown): Promise<SubmitAgentPromptResult> => {
			try {
				const request = submitAgentPromptRequestSchema.parse(raw);
				const provider = await agentModelCatalog.resolveAgentProvider(
					request.model,
				);
				if (request.planMode !== undefined) {
					planModeRegistry.setActive(request.sessionId, request.planMode);
				}
				const acknowledgement = await agentSessionService.submitPrompt({
					model: request.model ?? null,
					planMode: request.planMode,
					prompt: request.prompt,
					...(provider ? { provider } : {}),
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
		IPC_CHANNELS.stopAgentSession,
		async (_event, raw: unknown): Promise<StopAgentSessionResult> => {
			try {
				const request = stopAgentSessionRequestSchema.parse(raw);
				await agentSessionService.stopSession(request);
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
		IPC_CHANNELS.listAgentSessions,
		async (_event, raw: unknown): Promise<ListAgentSessionsResult> => {
			const request = listAgentSessionsRequestSchema.parse(raw);
			const sessions = agentSessionService.listSessionsForWorkspace(
				request.workspaceId,
			);
			return {
				sessions: sessions.map(snapshotToWire),
			};
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listAgentModels,
		(): Promise<AgentModelCatalog> => agentModelCatalog.list(),
	);

	ipcMain.handle(
		IPC_CHANNELS.listAgentSessionEvents,
		(_event, raw: unknown): Promise<ListAgentSessionEventsResult> => {
			const request = listAgentSessionEventsRequestSchema.parse(raw);
			const rows = agentSessionService.listEvents(request.branchId);
			const events: AgentSessionEventWire[] = rows.map((row) => ({
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
			return agentSessionService.writeForkSummary(request);
		},
	);
}
