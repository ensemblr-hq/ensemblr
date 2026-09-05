import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { AgentModelCatalog } from '../../../shared/ipc/contracts/agent-models';
import type {
	AgentSessionEventWire,
	ListAgentSessionEventsResult,
	ListAgentSessionsResult,
	OpenAgentSessionResult,
	RefreshAgentPlanUsageResult,
	StopAgentSessionResult,
	SubmitAgentPromptResult,
	WriteForkSummaryResult,
} from '../../../shared/ipc/contracts/agent-session';
import type { AfkModeRegistry } from '../../afk-mode';
import type { AgentModelCatalogService } from '../../agent-providers';
import {
	type AgentSessionService,
	snapshotToWire,
} from '../../agent-runtime/agent-session-service.ts';
import type { QueueProvisionalNamingPort } from '../../agent-runtime/naming/provisional-workspace-naming';
import type { PiExecutableService } from '../../pi-runtime';
import { isBlockedByPiExecutable } from '../../pi-runtime/pi-executable-gate.ts';
import type { PlanModeRegistry } from '../../plan-mode';
import type { WithPermissionGate } from '../permission-gate.ts';
import {
	listAgentSessionEventsRequestSchema,
	listAgentSessionsRequestSchema,
	openAgentSessionRequestSchema,
	refreshAgentPlanUsageRequestSchema,
	setAgentPlanModeRequestSchema,
	stopAgentSessionRequestSchema,
	submitAgentPromptRequestSchema,
	writeForkSummaryRequestSchema,
} from '../request-schemas.ts';

/**
 * Mirrors the chat's two mutually exclusive turn modes into their registries.
 *
 * Both flags are optional on the wire and `undefined` means "the user has no
 * opinion about this tab", so an absent flag clears nothing — a spawned child
 * inherits either mode through the control layer, and a request that never
 * mentioned one must not unblock a conversation nobody asked to unblock.
 *
 * Exclusivity resolves in favour of the flag the request actually states, so a
 * mode left in the registry by an earlier turn cannot veto the one the user just
 * switched on. When a request states both — which only a stale window can do —
 * Plan Mode wins: it is the more restrictive of the two, and AFK's whole promise
 * is that the agent keeps working, which is the opposite of what a planning turn
 * is for.
 * @param input - The request's flags, the session they apply to, and the two registries.
 */
function applyTurnModes({
	afkMode,
	afkModeRegistry,
	planMode,
	planModeRegistry,
	sessionId,
}: {
	afkMode: boolean | undefined;
	afkModeRegistry: AfkModeRegistry;
	planMode: boolean | undefined;
	planModeRegistry: PlanModeRegistry;
	sessionId: string;
}): void {
	if (planMode !== undefined) {
		planModeRegistry.setActive(sessionId, planMode);
	}
	if (afkMode !== undefined) {
		afkModeRegistry.setActive(sessionId, afkMode);
	}
	if (planMode === true) {
		afkModeRegistry.setActive(sessionId, false);
	} else if (afkMode === true) {
		planModeRegistry.setActive(sessionId, false);
	}
}

/**
 * Registers IPC handlers that expose the agent session service to the renderer.
 * @param options - Required services.
 */
export function registerAgentSessionHandlers({
	afkModeRegistry,
	agentModelCatalog,
	agentSessionService,
	piExecutableService,
	planModeRegistry,
	provisionalNamingQueue,
	withPermissionGate,
}: {
	/**
	 * Mirror of the renderer's per-chat AFK toggle, written here for the reason
	 * `planModeRegistry` is: the renderer's setting is the durable record and
	 * rides every open and submit, so the runtime never needs to persist it.
	 *
	 * There is no `setAgentAfkMode` counterpart. Plan Mode needs one because
	 * handing a plan off turns the toggle off while submitting no prompt to carry
	 * the new value; nothing turns AFK off without a prompt behind it.
	 */
	afkModeRegistry: AfkModeRegistry;
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
	 *
	 * `setAgentPlanMode` covers the one decision that changes the toggle without
	 * sending a prompt: handing a plan off to another chat leaves this session with
	 * nothing more to say, so nothing would otherwise carry the new value over.
	 */
	planModeRegistry: PlanModeRegistry;
	/**
	 * Names a planning workspace from the prompt that opened or drove it. Fired
	 * only while Plan Mode is on: outside it an agent names the workspace on its
	 * first turn anyway, and guessing ahead of that would spend a branch move to
	 * beat it by seconds.
	 */
	provisionalNamingQueue: QueueProvisionalNamingPort;
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
					afkMode: request.afkMode,
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
				applyTurnModes({
					afkMode: request.afkMode,
					afkModeRegistry,
					planMode: request.planMode,
					planModeRegistry,
					sessionId: snapshot.id,
				});
				if (request.planMode === true && request.initialPrompt) {
					provisionalNamingQueue({
						prompt: request.initialPrompt,
						sessionId: snapshot.id,
						workspaceId: request.workspaceId,
					});
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
				applyTurnModes({
					afkMode: request.afkMode,
					afkModeRegistry,
					planMode: request.planMode,
					planModeRegistry,
					sessionId: request.sessionId,
				});
				if (planModeRegistry.isActive(request.sessionId)) {
					provisionalNamingQueue({
						prompt: request.prompt,
						sessionId: request.sessionId,
						workspaceId: null,
					});
				}
				const acknowledgement = await agentSessionService.submitPrompt({
					afkMode: request.afkMode,
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
		IPC_CHANNELS.setAgentPlanMode,
		(_event, raw: unknown): void => {
			const request = setAgentPlanModeRequestSchema.parse(raw);
			applyTurnModes({
				afkMode: undefined,
				afkModeRegistry,
				planMode: request.planMode,
				planModeRegistry,
				sessionId: request.sessionId,
			});
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.refreshAgentPlanUsage,
		async (_event, raw: unknown): Promise<RefreshAgentPlanUsageResult> => {
			try {
				const request = refreshAgentPlanUsageRequestSchema.parse(raw);
				const refreshed = await agentSessionService.refreshPlanUsage(
					request.sessionId,
				);
				return { refreshed };
			} catch (cause) {
				console.warn('[agent-session] plan usage refresh failed.', cause);
				return { refreshed: false };
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
