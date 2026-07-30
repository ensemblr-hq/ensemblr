/**
 * Concrete {@link AgentControlPorts} built over the real main-process services.
 * This is the only place that knows how each control op maps onto chat-tab, Pi
 * session, terminal, script, and harness internals; the service and guardrails
 * stay ignorant of those details. Kept as thin delegation so it is obvious which
 * existing call each op reuses.
 */

import type {
	AgentControlModelList,
	AgentControlTabInfo,
	AgentControlTerminalInfo,
	AgentControlWorkspaceInfo,
	BoardStatusBroadcast,
	FocusViewBroadcast,
	PlanModeChangedBroadcast,
	TabsChangedBroadcast,
} from '../../shared/agent-control.ts';
import { resolveAgentRole } from '../../shared/agent-control.ts';
import { findHarnessDefinition } from '../../shared/agents.ts';
import type {
	PiPersistedEnvelope,
	PiWireMessagePayload,
} from '../../shared/ipc/contracts/pi-session';
import type { PermissionMode } from '../../shared/permissions.ts';
import type { HarnessDetectionService } from '../agents/index.ts';
import type { ChatTabService } from '../chat-tabs/chat-tab-service.ts';
import type { LocalCommandService } from '../commands';
import type { AppSettingsService } from '../config';
import {
	applyBranchSlug,
	BranchSlugRejected,
} from '../pi-agent/naming/apply-branch-slug.ts';
import { readSessionBriefNaming } from '../pi-agent/naming/session-brief-naming.ts';
import type { PiSessionService } from '../pi-agent/pi-session-service.ts';
import type { PiExecutableService } from '../pi-runtime';
import {
	presentPiModels,
	resolvePiProviderModels,
} from '../pi-runtime/pi-provider-models.ts';
import type { RenameWorkspaceService } from '../repository';
import type { ScriptLifecycleService } from '../scripts/script-lifecycle-service.ts';
import type { EnsemblrDatabaseService } from '../storage';
import {
	getChatTabById,
	setChatTabMetadata,
} from '../storage/repositories/chat-tab-repository.ts';
import { listAllWorkspaceRows } from '../storage/repositories/workspace-repository.ts';
import type { TerminalService } from '../terminal';
import type { BoardStatusStore } from './board-status-store.ts';
import type {
	AgentControlPorts,
	AskPort,
	BoardPort,
	ConfirmPort,
	ConversationPort,
	FocusPort,
	HarnessPort,
	PlanModePort,
	SessionNamingPort,
	TabPort,
	TerminalPort,
	WorkspacePort,
} from './ports.ts';
import { isSessionTabMarkedSubAgent } from './sub-agent-marker.ts';

/** Collaborators the adapters delegate to; supplied by the composition root. */
export interface PortAdapterDeps {
	databaseService: EnsemblrDatabaseService;
	chatTabService: ChatTabService;
	piSessionService: PiSessionService;
	terminalService: TerminalService;
	scriptLifecycleService: ScriptLifecycleService;
	harnessDetectionService: HarnessDetectionService;
	piExecutableService: PiExecutableService;
	localCommandService: LocalCommandService;
	appSettingsService: AppSettingsService;
	/** Names a workspace and its git branch together, for `setBranchName`. */
	renameWorkspace: RenameWorkspaceService['rename'];
	getPermissionMode: () => PermissionMode;
	/** Adds the agent-control MCP config and playbook to a harness launch command. */
	augmentHarnessCommand: (
		command: string,
		harnessId: string,
		workspaceId: string,
	) => string;
	/** Broadcasts a focus request to the renderer window showing the workspace. */
	broadcastFocus: (payload: FocusViewBroadcast) => void;
	/** Broadcasts a tab-set change so the renderer refreshes its tab list. */
	broadcastTabsChanged: (payload: TabsChangedBroadcast) => void;
	/**
	 * Broadcasts a chat tab's Plan Mode state so the renderer's per-chat toggle
	 * matches a spawn the renderer never made. Best-effort mirror only —
	 * enforcement reads the main-process registry, never this.
	 */
	broadcastPlanMode: (payload: PlanModeChangedBroadcast) => void;
	/** Broadcasts a board-status change so the renderer updates its board atom. */
	broadcastBoardStatus: (payload: BoardStatusBroadcast) => void;
	/** Main-side mirror of the renderer's board-status map. */
	boardStatusStore: BoardStatusStore;
	confirm: ConfirmPort;
	ask: AskPort;
	planMode: PlanModePort;
}

const IDLE_STATUSES: ReadonlySet<string> = new Set([
	'idle',
	'closed',
	'errored',
]);
const WAIT_POLL_MS = 400;

/**
 * Ceiling on the joined report {@link findFinalTurnText} returns. A turn's
 * assistant messages are read newest-first, so the cap sheds the narration that
 * opened the turn rather than the answer that closed it. It bounds a single
 * message too — clamped to its opening, which is where a report states its
 * answer — so one tool-heavy child cannot flood its orchestrator's context from
 * a single tool result it pasted whole.
 */
const MAX_REPORT_CHARS = 32_000;

/** Row shape read from {@link listAllWorkspaceRows} for the workspace listing. */
interface WorkspaceRow {
	id: string;
	name: string | null;
	path: string;
	archivedAt: string | null;
}

/**
 * Builds the workspace-listing port from the workspace repository.
 * @param deps - Adapter collaborators.
 * @returns The workspace port.
 */
function makeWorkspacePort(deps: PortAdapterDeps): WorkspacePort {
	return {
		listWorkspaces: async (): Promise<readonly AgentControlWorkspaceInfo[]> => {
			const database = deps.databaseService.getConnection()?.database;
			if (!database) {
				return [];
			}
			const rows = listAllWorkspaceRows({ database }) as WorkspaceRow[];
			return rows
				.filter((row) => row.archivedAt === null)
				.map((row) => ({
					workspaceId: row.id,
					name: row.name ?? row.id,
					cwd: row.path,
					boardStatus: deps.boardStatusStore.get(row.id),
				}));
		},
	};
}

/**
 * Builds the chat/terminal tab port over the chat-tab service and repository.
 * @param deps - Adapter collaborators.
 * @returns The tab port.
 */
function makeTabPort(deps: PortAdapterDeps): TabPort {
	const workspaceOfTab = (chatTabId: string): string | null => {
		const database = deps.databaseService.getConnection()?.database;
		if (!database) {
			return null;
		}
		return getChatTabById({ database, id: chatTabId })?.workspaceId ?? null;
	};

	return {
		spawnChatTab: async ({ workspaceId, title }) => {
			const tab = deps.chatTabService.openTab({
				kind: 'chat',
				workspaceId,
				title,
			});
			deps.broadcastTabsChanged({ workspaceId });
			return { chatTabId: tab.id };
		},
		closeTab: async ({ chatTabId }) => {
			const workspaceId = workspaceOfTab(chatTabId);
			deps.chatTabService.closeTab({ chatTabId });
			if (workspaceId) {
				deps.broadcastTabsChanged({ workspaceId });
			}
		},
		openNonChatTab: async ({
			workspaceId,
			variant,
			filePath,
			turnId,
			commentBody,
			prNumber,
		}) => {
			const kind = variant === 'comment' ? 'document' : variant;
			const metadata =
				variant === 'comment'
					? { commentPreview: { body: commentBody, prNumber } }
					: variant === 'diff'
						? { filePath, turnId }
						: { filePath };
			const tab = deps.chatTabService.openTab({ kind, workspaceId, metadata });
			deps.broadcastTabsChanged({ workspaceId });
			return { chatTabId: tab.id };
		},
		listTabs: async ({
			workspaceId,
		}): Promise<readonly AgentControlTabInfo[]> => {
			const { open } = deps.chatTabService.listTabs({ workspaceId });
			return open.map((tab) => ({
				chatTabId: tab.id,
				kind: tab.kind,
				title: tab.title,
				workspaceId: tab.workspaceId,
				piSessionId: tab.piSessionId,
			}));
		},
		resolveTabWorkspace: async (chatTabId) => workspaceOfTab(chatTabId),
	};
}

/**
 * Builds the Pi conversation port over the Pi session service. `piSessionId` on
 * the wire is the service's internal session id (stable across the runtime id).
 * @param deps - Adapter collaborators.
 * @returns The conversation port.
 */
function makeConversationPort(deps: PortAdapterDeps): ConversationPort {
	const requireExecutable = async () => {
		const executable = await deps.piExecutableService.getSnapshot();
		if (executable.status === 'error' || !executable.command) {
			throw new Error('Pi executable is unavailable.');
		}
		return executable;
	};

	const loadModelCatalog = async (): Promise<AgentControlModelList> => {
		const executable = await deps.piExecutableService.getSnapshot();
		const snapshot = await resolvePiProviderModels({
			executable,
			localCommandService: deps.localCommandService,
		});
		const presented = presentPiModels(snapshot);
		return {
			defaultModelId: presented.defaultModelId,
			models: presented.models.map((model) => ({
				id: model.id,
				provider: model.provider,
				displayName: model.displayName,
			})),
		};
	};

	/**
	 * Best guess at the spawning agent's model: the caller's own model when the
	 * extension forwarded a valid one, else the workspace's most-recently-updated
	 * open Pi session (usually the master), else the catalog default. Used both as
	 * the fallback model and to constrain a requested model to the same provider.
	 */
	const resolveMasterModel = (
		workspaceId: string,
		callerModel: string | undefined,
		catalog: AgentControlModelList,
	): string | null => {
		const available = new Set(catalog.models.map((model) => model.id));
		if (callerModel && available.has(callerModel)) {
			return callerModel;
		}
		const recent = [
			...deps.piSessionService.listSessionsForWorkspace(workspaceId),
		]
			.filter((session) => session.model && available.has(session.model))
			.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
		return recent?.model ?? catalog.defaultModelId ?? null;
	};

	/**
	 * Resolves the model a spawned conversation should use. A requested model is
	 * honored only when it exists AND matches the master's provider; otherwise the
	 * child inherits the master's model. Degrades to the raw request/caller/default
	 * if the model catalog cannot be loaded, so a spawn is never blocked.
	 */
	const resolveModel = async (
		requested: string | undefined,
		callerModel: string | undefined,
		workspaceId: string,
	): Promise<string | null> => {
		let catalog: AgentControlModelList;
		try {
			catalog = await loadModelCatalog();
		} catch (cause) {
			console.warn('[agent-control] model catalog unavailable for a spawn.', {
				cause: cause instanceof Error ? cause.message : String(cause),
				requested: requested ?? null,
				workspaceId,
			});
			return requested ?? callerModel ?? null;
		}
		const providerOf = new Map(
			catalog.models.map((model) => [model.id, model.provider] as const),
		);
		const master = resolveMasterModel(workspaceId, callerModel, catalog);
		const masterProvider = master ? providerOf.get(master) : undefined;
		if (
			requested &&
			providerOf.has(requested) &&
			(masterProvider === undefined ||
				providerOf.get(requested) === masterProvider)
		) {
			return requested;
		}
		return master;
	};

	return {
		listModels: loadModelCatalog,
		startConversation: async ({
			workspaceId,
			workspaceCwd,
			chatTabId,
			prompt,
			model,
			thinkingLevel,
			title,
			callerModel,
			parentSessionId,
			planMode,
		}) => {
			const executable = await requireExecutable();
			const resolvedModel = await resolveModel(model, callerModel, workspaceId);
			const openedTabId = chatTabId
				? null
				: deps.chatTabService.openTab({ kind: 'chat', workspaceId }).id;
			if (openedTabId) {
				deps.broadcastTabsChanged({ workspaceId });
			}
			const targetTabId = chatTabId ?? openedTabId;
			if (!targetTabId) {
				throw new Error('Failed to resolve a chat tab for the conversation.');
			}
			const snapshot = await deps.piSessionService.openSession({
				chatTabId: targetTabId,
				workspaceId,
				workspaceCwd,
				model: resolvedModel,
				thinkingLevel: thinkingLevel ?? null,
				initialPrompt: prompt,
				executable,
				parentSessionId,
			});
			// Registered before `submitPrompt` because the child can reach
			// `before_agent_start` first.
			if (planMode) {
				deps.planMode.activateForSpawn(snapshot.id);
				deps.broadcastPlanMode({
					chatTabId: targetTabId,
					piSessionId: snapshot.id,
					planMode: true,
					workspaceId,
				});
			}
			// `submitPrompt` captures a git checkpoint first, and the renderer resolves
			// a tab's branch id out of the session list, so a binding announced after
			// it leaves the tab a blank rectangle for that whole window.
			const markerApplied = writeSubAgentMarker(deps, targetTabId, 'subagent');
			deps.broadcastTabsChanged({ workspaceId });
			try {
				await deps.piSessionService.submitPrompt({
					sessionId: snapshot.id,
					prompt,
					model: resolvedModel,
					thinkingLevel: thinkingLevel ?? null,
				});
			} catch (error) {
				await rollbackConversation(deps, {
					piSessionId: snapshot.id,
					openedTabId,
					markedTabId: markerApplied ? targetTabId : null,
					workspaceId,
				});
				throw error;
			}
			if (title) {
				await applyConversationName(deps, {
					name: title,
					piSessionId: snapshot.id,
				});
			}
			deps.broadcastTabsChanged({ workspaceId });
			return { chatTabId: targetTabId, piSessionId: snapshot.id };
		},
		sendFollowUp: async ({ piSessionId, prompt }) => {
			const streaming =
				deps.piSessionService.getSession(piSessionId)?.status === 'streaming';
			await deps.piSessionService.submitPrompt({
				sessionId: piSessionId,
				prompt,
				streamingBehavior: streaming ? 'followUp' : undefined,
			});
		},
		setName: async ({ piSessionId, name }) => {
			const applied = await applyConversationName(deps, { name, piSessionId });
			if (applied?.applied) {
				const workspaceId =
					deps.piSessionService.getSession(piSessionId)?.workspaceId;
				if (workspaceId) {
					deps.broadcastTabsChanged({ workspaceId });
				}
			}
			return applied;
		},
		waitForIdle: async (piSessionId, timeoutMs) => {
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				const status = deps.piSessionService.getSession(piSessionId)?.status;
				if (!status || IDLE_STATUSES.has(status)) {
					return 'completed';
				}
				await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
			}
			return 'timeout';
		},
		getStatus: async (piSessionId) => {
			const snapshot = deps.piSessionService.getSession(piSessionId);
			if (!snapshot) {
				return null;
			}
			return {
				piSessionId: snapshot.id,
				status: snapshot.status,
				runtimeOpen: snapshot.runtimeOpen,
			};
		},
		hasFinalMessage: async (piSessionId) => {
			const snapshot = deps.piSessionService.getSession(piSessionId);
			if (!snapshot) {
				return false;
			}
			return findFinalTurnText(deps, snapshot.branchId) !== null;
		},
		getLastMessage: async (piSessionId) => {
			const snapshot = deps.piSessionService.getSession(piSessionId);
			if (!snapshot) {
				return null;
			}
			return findFinalTurnText(deps, snapshot.branchId);
		},
		isSpawnedSubAgent: async (piSessionId) =>
			readSubAgentMarker(deps, piSessionId),
		resolveConversationWorkspace: async (piSessionId) =>
			deps.piSessionService.getSession(piSessionId)?.workspaceId ?? null,
	};
}

/**
 * Stamps or clears the sub-agent marker on a chat tab. The renderer reads it to
 * tint the tab and to lock its composer, so it is written before the first prompt
 * is submitted and cleared again if that submit fails. Best-effort and idempotent:
 * a missing database or tab is ignored.
 *
 * The return value is what makes the rollback safe. A caller may reuse a tab that
 * is already marked from an earlier spawn, in which case this writes nothing —
 * and a rollback that cleared the marker anyway would strip a live sub-agent of
 * its role, handing it back the whole control surface.
 * @param deps - Adapter collaborators.
 * @param chatTabId - The tab bound to the spawned conversation.
 * @param role - `'subagent'` to stamp the marker, `null` to clear it.
 * @returns True when this call changed the marker, false when it was already there.
 */
function writeSubAgentMarker(
	deps: PortAdapterDeps,
	chatTabId: string,
	role: 'subagent' | null,
): boolean {
	const database = deps.databaseService.getConnection()?.database;
	if (!database) {
		return false;
	}
	try {
		const tab = getChatTabById({ database, id: chatTabId });
		if (!tab || (tab.metadata.agentRole ?? null) === role) {
			return false;
		}
		const withoutRole = Object.fromEntries(
			Object.entries(tab.metadata).filter(([key]) => key !== 'agentRole'),
		);
		setChatTabMetadata({
			database,
			id: chatTabId,
			metadata: role ? { ...withoutRole, agentRole: role } : withoutRole,
		});
		return true;
	} catch (cause) {
		console.warn('[agent-control] could not tint a tab as a sub-agent.', {
			cause: cause instanceof Error ? cause.message : String(cause),
			chatTabId,
		});
		return false;
	}
}

/**
 * Reads the sub-agent marker {@link writeSubAgentMarker} wrote, off the chat tab
 * bound to a Pi session.
 * @param deps - Adapter collaborators.
 * @param piSessionId - The session whose tab to inspect.
 * @returns True when the session's tab is stamped as hosting a spawned sub-agent.
 */
function readSubAgentMarker(
	deps: PortAdapterDeps,
	piSessionId: string,
): boolean {
	return isSessionTabMarkedSubAgent(
		deps.databaseService.getConnection()?.database,
		piSessionId,
	);
}

/**
 * Applies a display name to a conversation's tab via the Pi session service,
 * swallowing failures so naming never breaks a spawn or a control call. Always
 * claims `agent` provenance: every route here is an agent naming a tab, so a
 * title the user chose outranks it and comes back `applied: false`.
 * @param deps - Adapter collaborators.
 * @param input - The target session id and the requested name.
 * @returns The tab id and title with whether the rename landed, or null when the session could not be named.
 */
async function applyConversationName(
	deps: PortAdapterDeps,
	input: { piSessionId: string; name: string },
): Promise<{ applied: boolean; chatTabId: string; title: string } | null> {
	try {
		return await deps.piSessionService.setSessionName({
			name: input.name,
			provenance: 'agent',
			sessionId: input.piSessionId,
		});
	} catch (cause) {
		console.warn('[agent-control] could not name a conversation tab.', {
			cause: cause instanceof Error ? cause.message : String(cause),
			piSessionId: input.piSessionId,
		});
		return null;
	}
}

/**
 * Tears down a conversation that failed to submit its first prompt, so a throw
 * mid-`startConversation` does not strand a live Pi session or an empty chat
 * tab. Best-effort: cleanup errors are swallowed so the original failure is the
 * one surfaced to the caller. The Plan Mode release is unconditional — dropping a
 * session that never planned is a no-op, and the shutdown path cannot be relied
 * on here because this function swallows a failed `stopSession`.
 * @param deps - Adapter collaborators.
 * @param target - The session to stop, the tab this call opened, the tab this call marked, and its workspace.
 */
async function rollbackConversation(
	deps: PortAdapterDeps,
	target: {
		piSessionId: string;
		openedTabId: string | null;
		markedTabId: string | null;
		workspaceId: string;
	},
): Promise<void> {
	deps.planMode.releaseSession(target.piSessionId);
	if (target.markedTabId) {
		writeSubAgentMarker(deps, target.markedTabId, null);
	}
	try {
		await deps.piSessionService.stopSession({
			sessionId: target.piSessionId,
			reason: 'agent-control-start-failed',
		});
	} catch (cause) {
		console.warn('[agent-control] could not stop a failed spawn.', {
			cause: cause instanceof Error ? cause.message : String(cause),
			piSessionId: target.piSessionId,
		});
	}
	if (target.openedTabId) {
		try {
			deps.chatTabService.closeTab({ chatTabId: target.openedTabId });
			deps.broadcastTabsChanged({ workspaceId: target.workspaceId });
		} catch (cause) {
			console.warn('[agent-control] could not close a failed spawn tab.', {
				cause: cause instanceof Error ? cause.message : String(cause),
				chatTabId: target.openedTabId,
			});
		}
	}
}

/**
 * Scans a conversation branch newest-first for the newest turn that produced an
 * answer and joins every assistant message in it, so status and last-message
 * reads share one definition of "has a final report" without loading the whole
 * branch. A whole turn rather than a single message because an agent that writes
 * its report and then signs off with a one-line hand-off leaves two messages, and
 * reading only the newest returns the hand-off and throws the report away. A
 * prompt that has not been answered yet is skipped rather than treated as the
 * end, so a child re-prompted mid-read still reports the work it already filed.
 * A tool-heavy turn can hold dozens of assistant messages, so the join stops at
 * {@link MAX_REPORT_CHARS} and drops the oldest — the narration an agent writes
 * on its way to the answer, never the answer itself, which is the newest. A
 * newest message that busts the ceiling on its own is clamped to its opening
 * rather than returned whole, so the ceiling really is a ceiling.
 * The session service yields persisted payloads lazily and already excludes
 * checkpoint-hidden turns; persisted events survive the session closing and app
 * restarts, so this recovers a finished child's report even when it is no
 * longer live.
 * @param deps - Adapter collaborators exposing the Pi session service.
 * @param branchId - The conversation branch whose events to scan.
 * @returns The final turn's assistant text, or null when the branch has none.
 */
function findFinalTurnText(
	deps: PortAdapterDeps,
	branchId: string,
): string | null {
	const turn: string[] = [];
	let size = 0;
	for (const payload of deps.piSessionService.iterateEventPayloadsDescending(
		branchId,
	)) {
		if (isTurnBoundary(payload)) {
			if (turn.length > 0) {
				break;
			}
			continue;
		}
		const text = extractAssistantText(payload);
		if (!text) {
			continue;
		}
		const remaining = MAX_REPORT_CHARS - size;
		if (text.length <= remaining) {
			turn.push(text);
			size += text.length;
			continue;
		}
		if (turn.length === 0) {
			turn.push(text.slice(0, remaining));
		}
		break;
	}
	return turn.length > 0 ? turn.reverse().join('\n\n') : null;
}

/**
 * Whether a persisted event is the user prompt that opened a turn, which is
 * where a newest-first scan of the final turn stops.
 * @param payload - A persisted Pi event envelope, or null for a gap.
 * @returns True when the envelope is a user-role message.
 */
function isTurnBoundary(
	payload: PiPersistedEnvelope | null | undefined,
): boolean {
	return payload?.kind === 'message' && payload.role === 'user';
}

/**
 * Extracts the assistant's visible answer from a persisted Pi event envelope.
 * Persisted events are {@link PiPersistedEnvelope} tagged unions, so a completed
 * assistant turn is an `agent`-role `message` whose inner payload holds the
 * final text (as `message` parts or a standalone `text` payload). Reasoning
 * parts, tool calls, streaming deltas, and non-agent envelopes yield null, so a
 * final-turn scan collects only the answers the agent meant to leave behind.
 * @param payload - A persisted Pi event envelope, or null for a gap.
 * @returns The assistant text, or null when the event carries none.
 */
function extractAssistantText(
	payload: PiPersistedEnvelope | null | undefined,
): string | null {
	if (payload?.kind !== 'message' || payload.role !== 'agent') {
		return null;
	}
	const text = messagePayloadText(payload.payload);
	return text.length > 0 ? text : null;
}

/**
 * Concatenates the visible text of an agent message payload: the text parts of
 * a completed message, or a standalone text payload. Reasoning, deltas, and
 * tool payloads contribute nothing.
 * @param payload - The inner wire message payload of an agent envelope.
 * @returns The joined assistant text, possibly empty.
 */
function messagePayloadText(payload: PiWireMessagePayload): string {
	if (payload.kind === 'text') {
		return payload.text;
	}
	if (payload.kind === 'message') {
		return payload.parts
			.flatMap((part) => (part.kind === 'text' ? [part.text] : []))
			.join('');
	}
	return '';
}

/**
 * Builds the terminal port over the terminal and script-lifecycle services.
 * @param deps - Adapter collaborators.
 * @returns The terminal port.
 */
function makeTerminalPort(deps: PortAdapterDeps): TerminalPort {
	return {
		startTerminal: async ({ workspaceId, kind }) => {
			if (kind === 'spawn') {
				const result = await deps.terminalService.create({
					kind: 'terminal',
					workspaceId,
				});
				return { terminalId: result.session?.id ?? '' };
			}
			const result = await deps.scriptLifecycleService.runScript({
				kind,
				workspaceId,
			});
			return { terminalId: result.session?.id ?? '' };
		},
		stopTerminal: async ({ workspaceId, terminalId, kind }) => {
			if (terminalId) {
				deps.terminalService.kill(terminalId);
				return;
			}
			if (kind) {
				await deps.scriptLifecycleService.stopScript({ kind, workspaceId });
			}
		},
		writeTerminal: async ({ terminalId, input }) => {
			deps.terminalService.write(terminalId, input);
		},
		readOutput: async (terminalId) =>
			deps.terminalService.getSnapshot(terminalId).scrollback ?? null,
		listTerminals: async ({
			workspaceId,
		}): Promise<readonly AgentControlTerminalInfo[]> =>
			deps.terminalService.list(workspaceId).map((session) => ({
				terminalId: session.id,
				kind: session.kind,
				status: session.status,
				workspaceId: session.workspaceId,
			})),
		resolveTerminalWorkspace: async (terminalId) =>
			deps.terminalService.getSnapshot(terminalId).session?.workspaceId ?? null,
	};
}

/**
 * Builds the harness-launch port, replicating the agents IPC handler's launch
 * flow but also opening and repointing a terminal chat tab.
 * @param deps - Adapter collaborators.
 * @returns The harness port.
 */
function makeHarnessPort(deps: PortAdapterDeps): HarnessPort {
	return {
		launchHarness: async ({ workspaceId, harnessId }) => {
			const command =
				await deps.harnessDetectionService.resolveLaunchCommand(harnessId);
			if (!command) {
				throw new Error(`Harness "${harnessId}" is unavailable.`);
			}
			const label = findHarnessDefinition(harnessId)?.label ?? harnessId;
			const tab = deps.chatTabService.openTab({
				kind: 'terminal',
				workspaceId,
				title: label,
				metadata: { harnessId, harnessLabel: label },
			});
			deps.broadcastTabsChanged({ workspaceId });
			const result = await deps.terminalService.create({
				command: deps.augmentHarnessCommand(command, harnessId, workspaceId),
				harnessId,
				kind: 'agent',
				title: label,
				workspaceId,
			});
			const terminalId = result.session?.id ?? '';
			const database = deps.databaseService.getConnection()?.database;
			if (database && terminalId) {
				setChatTabMetadata({
					database,
					id: tab.id,
					metadata: { ...tab.metadata, terminalId },
				});
			}
			return { chatTabId: tab.id, terminalId };
		},
	};
}

/**
 * Builds the focus port that broadcasts renderer focus requests.
 * @param deps - Adapter collaborators.
 * @returns The focus port.
 */
function makeFocusPort(deps: PortAdapterDeps): FocusPort {
	return {
		focusTab: ({ workspaceId, chatTabId }) =>
			deps.broadcastFocus({
				workspaceId,
				target: { kind: 'tab', chatTabId },
			}),
		focusDockTab: ({ workspaceId, dock }) =>
			deps.broadcastFocus({ workspaceId, target: { kind: 'dock', dock } }),
		focusPanel: ({ workspaceId, panel }) =>
			deps.broadcastFocus({ workspaceId, target: { kind: 'panel', panel } }),
	};
}

/**
 * Builds the board port: writes broadcast to the renderer and update the mirror
 * optimistically; reads serve from the mirror.
 * @param deps - Adapter collaborators.
 * @returns The board port.
 */
function makeBoardPort(deps: PortAdapterDeps): BoardPort {
	return {
		setWorkspaceStatus: ({ workspaceId, status }) => {
			deps.boardStatusStore.setOne(workspaceId, status);
			deps.broadcastBoardStatus({ workspaceId, status });
		},
		getWorkspaceStatus: (workspaceId) => deps.boardStatusStore.get(workspaceId),
	};
}

/**
 * Builds the session-naming port over the workspace rename service, the naming
 * policy module, and the Pi session service. Naming policy itself lives in
 * `pi-agent/naming/`; this stays wiring — resolve the database and the user's
 * setting, delegate, then broadcast whatever landed.
 * @param deps - Adapter collaborators.
 * @returns The session-naming port.
 */
function makeSessionNamingPort(deps: PortAdapterDeps): SessionNamingPort {
	/**
	 * Reads the user's "Let agents name the workspace and branch" setting, which
	 * gates both the per-turn branch nudge and the `setBranchName` tool itself.
	 * @returns True while the user lets agents name the workspace and branch.
	 */
	const namingEnabled = (): boolean =>
		deps.appSettingsService.read().git.renameWorkspaceOnBranch;

	return {
		readBrief: async (origin) =>
			readSessionBriefNaming({
				caller: {
					isSubAgent:
						resolveAgentRole(
							readSubAgentMarker(deps, origin.sessionId),
							origin.depth,
						) === 'subagent',
					sessionId: origin.sessionId,
					species: origin.species,
					workspaceId: origin.workspaceId,
				},
				database: deps.databaseService.getConnection()?.database,
				namingEnabled,
			}),
		setBranchName: async ({ origin, slug }) => {
			const database = deps.databaseService.getConnection()?.database;
			if (!database) {
				throw new BranchSlugRejected(
					'unknown-workspace',
					'The workspace database is unavailable.',
				);
			}
			const result = await applyBranchSlug({
				database,
				name: slug,
				namingEnabled: namingEnabled(),
				renameWorkspace: deps.renameWorkspace,
				workspaceId: origin.workspaceId,
			});
			if (result.applied && origin.species === 'pi') {
				deps.piSessionService.appendWorkspaceRenamed(origin.sessionId);
			}
			if (result.applied) {
				deps.broadcastTabsChanged({ workspaceId: origin.workspaceId });
			}
			return result;
		},
		setSummary: async ({ origin, summary, title }) => {
			const recorded = deps.piSessionService.setSessionSummary({
				sessionId: origin.sessionId,
				summary,
				title,
			});
			if (!recorded) {
				throw new Error(
					'Cannot record a summary: the calling conversation has no chat tab.',
				);
			}
			return {
				capturedAtOrdinal: recorded.capturedAtOrdinal,
				message:
					'Recorded. Refresh it at the end of each turn so the tab always describes where the work stands.',
			};
		},
	};
}

/**
 * Assembles the full {@link AgentControlPorts} surface from real services.
 * @param deps - Adapter collaborators.
 * @returns Ports ready to pass to {@link createAgentControlService}.
 */
export function createAgentControlPorts(
	deps: PortAdapterDeps,
): AgentControlPorts {
	return {
		workspaces: makeWorkspacePort(deps),
		tabs: makeTabPort(deps),
		conversations: makeConversationPort(deps),
		terminals: makeTerminalPort(deps),
		harnesses: makeHarnessPort(deps),
		focus: makeFocusPort(deps),
		board: makeBoardPort(deps),
		sessionNaming: makeSessionNamingPort(deps),
		permissions: { getMode: () => deps.getPermissionMode() },
		confirm: deps.confirm,
		ask: deps.ask,
		planMode: deps.planMode,
	};
}
