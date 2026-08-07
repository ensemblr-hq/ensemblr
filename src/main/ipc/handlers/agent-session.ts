import { ipcMain } from 'electron';

import {
	type AgentProviderId,
	DEFAULT_AGENT_PROVIDER,
} from '../../../shared/agent-provider.ts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	AgentModelCatalog,
	AgentModelOption,
} from '../../../shared/ipc/contracts/agent-models';
import type {
	AgentSessionEventWire,
	ListAgentSessionEventsResult,
	ListAgentSessionsResult,
	OpenAgentSessionResult,
	StopAgentSessionResult,
	SubmitAgentPromptResult,
	WriteForkSummaryResult,
} from '../../../shared/ipc/contracts/agent-session';
import { createAgentModelCatalog } from '../../agent-providers/agent-model-catalog.ts';
import {
	type AgentSessionService,
	snapshotToWire,
} from '../../agent-runtime/agent-session-service.ts';
import type { LocalCommandService } from '../../commands/local-command';
import type {
	PiExecutableService,
	PiExecutableSnapshot,
} from '../../pi-runtime';
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
	listClaudeModels,
	localCommandService,
	piExecutableService,
	agentSessionService,
	planModeRegistry,
	withPermissionGate,
}: {
	/**
	 * Lists the Claude Code models this account can run, merged into the same
	 * catalog as Pi's. Absent when the Claude runtime is not wired up, which
	 * leaves the picker Pi-only rather than empty.
	 */
	listClaudeModels?: () => Promise<readonly AgentModelOption[]>;
	localCommandService: LocalCommandService;
	piExecutableService: PiExecutableService;
	agentSessionService: AgentSessionService;
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
	const agentModelCatalog = createAgentModelCatalog({
		listClaudeModels,
		localCommandService,
		piExecutableService,
	});

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

/**
 * Whether an open has to wait on Pi's executable. Only the runtime this snapshot
 * describes is gated on it: keying the check on "is not Claude" would block every
 * runtime added after Claude on a binary it never launches, though each resolves
 * its own executable at open time. A provider the catalog could not resolve is
 * gated too, because the opener falls back to Pi for it.
 * @param input - The provider the open resolved to, and Pi's current executable snapshot.
 * @returns True when the session cannot open until Pi's setup checks are resolved.
 */
function isBlockedByPiExecutable({
	executable,
	provider,
}: {
	executable: PiExecutableSnapshot;
	provider: AgentProviderId | null;
}): boolean {
	if ((provider ?? DEFAULT_AGENT_PROVIDER) !== DEFAULT_AGENT_PROVIDER) {
		return false;
	}
	return executable.status === 'error' || !executable.command;
}
