/**
 * Concrete {@link AgentControlPorts} built over the real main-process services.
 * This is the only place that knows how each control op maps onto chat-tab, Pi
 * session, terminal, script, and harness internals; the service and guardrails
 * stay ignorant of those details. Kept as thin delegation so it is obvious which
 * existing call each op reuses.
 */

import { posix as posixPath } from 'node:path';

import type {
	AgentControlModelList,
	AgentControlTabInfo,
	AgentControlTerminalInfo,
	AgentControlWorkspaceInfo,
	BoardStatusBroadcast,
	FocusViewBroadcast,
	LinearAccountRef,
	PlanModeChangedBroadcast,
	ReviewCommentsChangedBroadcast,
	TabsChangedBroadcast,
} from '../../shared/agent-control.ts';
import {
	buildConversationTranscript,
	MAX_AGENT_PAYLOAD_CHARS,
	resolveAgentRole,
} from '../../shared/agent-control.ts';
import type { AgentProviderId } from '../../shared/agent-provider.ts';
import { findHarnessDefinition } from '../../shared/agents.ts';
import type { AppLanguage } from '../../shared/i18n.ts';
import type {
	AgentPersistedEnvelope,
	AgentWireMessagePayload,
} from '../../shared/ipc/contracts/agent-session.ts';
import type { CreateTerminalSessionResult } from '../../shared/ipc/contracts/terminal.ts';
import type { PermissionMode } from '../../shared/permissions.ts';
import { selectDefaultRunScript } from '../../shared/scripts.ts';
import type {
	SpawnCallerIdentity,
	SpawnModelResolver,
} from '../agent-providers';
import type { AgentSessionService } from '../agent-runtime/agent-session-service.ts';
import {
	applyBranchSlug,
	BranchSlugRejected,
} from '../agent-runtime/naming/apply-branch-slug.ts';
import type { SessionBriefCaller } from '../agent-runtime/naming/session-brief-naming.ts';
import { readSessionBriefNaming } from '../agent-runtime/naming/session-brief-naming.ts';
import type { HarnessDetectionService } from '../agents/index.ts';
import type { ChatTabService } from '../chat-tabs/chat-tab-service.ts';
import type { AppSettingsService } from '../config';
import type { LinearService } from '../linear';
import type { PiExecutableService } from '../pi-runtime';
import { isBlockedByPiExecutable } from '../pi-runtime/pi-executable-gate.ts';
import type { RenameWorkspaceService } from '../repository';
import type { ReviewService } from '../review';
import type { ScriptLifecycleService } from '../scripts/script-lifecycle-service.ts';
import type { EnsemblrDatabaseService } from '../storage';
import type { ChatTabRow } from '../storage/repositories/chat-tab-repository.ts';
import {
	getChatTabById,
	setChatTabMetadata,
} from '../storage/repositories/chat-tab-repository.ts';
import { listAllWorkspaceRows } from '../storage/repositories/workspace-repository.ts';
import { type TerminalService, toReadableScrollback } from '../terminal';
import type { WorkspaceGitService } from '../workspace-git';
import type { BoardStatusStore } from './board-status-store.ts';
import { makeLinearPort } from './linear-ports.ts';
import {
	type AgentControlOrigin,
	type AgentControlPorts,
	type AskPort,
	type BoardPort,
	type ConciergePort,
	type ConfirmPort,
	type ConversationPort,
	type FocusPort,
	type HarnessPort,
	type MemoryPort,
	originHasChatTab,
	type PlanModePort,
	type SessionNamingPort,
	type StartTerminalOutcome,
	type TabPort,
	type TerminalPort,
	type WorkspaceCreationPort,
	type WorkspacePort,
} from './ports.ts';
import { makeDiffPort, makeReviewPort } from './review-ports.ts';
import { isSessionTabMarkedSubAgent } from './sub-agent-marker.ts';

/**
 * What an untitled tab is called when an agent lists tabs. The stored title is
 * blank so the UI can localize it, but agent-facing prose stays English — an
 * empty string would read to the agent as a tab with no identity at all.
 */
const UNNAMED_TAB_TITLE = 'New chat';

/**
 * Names a file or diff tab an agent opened after the file it targets, the same
 * title the renderer's own openers stamp. A file name is locale-neutral, so
 * writing it from here does not freeze the row into one language; a comment tab
 * has no path to name it and opens untitled instead.
 * @param filePath - Workspace-relative path the tab targets, when it has one
 * @returns The tab title, or an empty string to leave the row untitled
 */
function fileTabTitle(filePath: string | undefined): string {
	return filePath ? posixPath.basename(filePath) : '';
}

/** Collaborators the adapters delegate to; supplied by the composition root. */
export interface PortAdapterDeps {
	databaseService: EnsemblrDatabaseService;
	chatTabService: ChatTabService;
	agentSessionService: AgentSessionService;
	terminalService: TerminalService;
	scriptLifecycleService: ScriptLifecycleService;
	harnessDetectionService: HarnessDetectionService;
	piExecutableService: PiExecutableService;
	/** Decides a delegated child's model, runtime, and thinking level. */
	spawnModelResolver: SpawnModelResolver;
	appSettingsService: AppSettingsService;
	workspaceGitService: WorkspaceGitService;
	reviewService: ReviewService;
	/**
	 * The app's Linear data service, or null when the integration is not composed.
	 * Nullable rather than optional so the composition root has to state which it
	 * is; the port answers `not-connected` either way.
	 */
	linearService: LinearService | null;
	/**
	 * Names the connected Linear accounts, so a failed Linear op can hand the
	 * agent the choice it could not make. Empty when Linear is not composed in.
	 */
	listLinearAccounts: () => Promise<readonly LinearAccountRef[]>;
	/** Names a workspace and its git branch together, for `setBranchName`. */
	renameWorkspace: RenameWorkspaceService['rename'];
	/**
	 * The three Concierge-only ports, or null when the Concierge is not composed
	 * in. Nullable rather than optional so the composition root has to state which
	 * it is — the service refuses the ops either way, but silently omitting them
	 * would read as a wiring bug rather than a decision.
	 */
	conciergePorts: {
		concierge: ConciergePort;
		memory: MemoryPort;
		workspaceCreation: WorkspaceCreationPort;
	} | null;
	getPermissionMode: () => PermissionMode;
	/** Reads the language the app renders in, for the playbooks' language directive. */
	getLanguage: () => AppLanguage;
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
	 * Broadcasts an agent's review-comment write so the renderer refreshes the
	 * comment list a user may already be watching.
	 */
	broadcastReviewCommentsChanged: (
		payload: ReviewCommentsChangedBroadcast,
	) => void;
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

/** Row shape read from {@link listAllWorkspaceRows} for the workspace listing. */
interface WorkspaceRow {
	id: string;
	name: string | null;
	path: string;
	archivedAt: string | null;
	repositoryId: string;
	repositoryName: string | null;
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
					projectId: row.repositoryId,
					projectName: row.repositoryName ?? row.repositoryId,
					boardStatus: deps.boardStatusStore.get(row.id),
				}));
		},
	};
}

/**
 * Reads a tab row straight from the repository, bypassing the chat-tab service
 * so a close can be inspected before and after it is attempted.
 * @param deps - Adapter collaborators.
 * @param chatTabId - Tab to read.
 * @returns The row, or null when it is gone or the database is not connected.
 */
function readTabRow(
	deps: PortAdapterDeps,
	chatTabId: string,
): ChatTabRow | null {
	const database = deps.databaseService.getConnection()?.database;
	if (!database) {
		return null;
	}
	return getChatTabById({ database, id: chatTabId }) ?? null;
}

/**
 * Whether a tab is still in the open set, for telling a close that landed from
 * one the service refused. A read that throws answers "still open": a stale
 * unread mark is recoverable, while claiming a close that did not happen retires
 * the mark of a tab still on screen.
 * @param deps - Adapter collaborators.
 * @param chatTabId - Tab to check.
 * @returns True while the row is present with no close timestamp.
 */
function isTabStillOpen(deps: PortAdapterDeps, chatTabId: string): boolean {
	try {
		return readTabRow(deps, chatTabId)?.closedAt === null;
	} catch {
		return true;
	}
}

/**
 * Builds the broadcast for an attempted close, naming the chat only when one
 * really left the open set. `chatTabService.closeTab` is a no-op for a tab that
 * is already closed and for a workspace's last open chat, and a payload claiming
 * a close that did not happen would retire the unread mark of a tab still on
 * screen. Non-chat tabs are never named: only a chat carries an unread mark.
 * @param deps - Adapter collaborators.
 * @param closed - The tab the close was attempted on, as known before the call.
 * @returns The broadcast to send.
 */
function toTabsChangedAfterClose(
	deps: PortAdapterDeps,
	closed: {
		agentSessionId: string | null;
		chatTabId: string;
		isChat: boolean;
		workspaceId: string;
	},
): TabsChangedBroadcast {
	if (!closed.isChat || isTabStillOpen(deps, closed.chatTabId)) {
		return { workspaceId: closed.workspaceId };
	}
	return {
		closedChat: {
			agentSessionId: closed.agentSessionId,
			chatTabId: closed.chatTabId,
		},
		workspaceId: closed.workspaceId,
	};
}

/**
 * Builds the chat/terminal tab port over the chat-tab service and repository.
 * @param deps - Adapter collaborators.
 * @returns The tab port.
 */
function makeTabPort(deps: PortAdapterDeps): TabPort {
	const readTab = (chatTabId: string): ChatTabRow | null =>
		readTabRow(deps, chatTabId);

	const workspaceOfTab = (chatTabId: string): string | null =>
		readTab(chatTabId)?.workspaceId ?? null;

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
			// Read before the close: an emptied tab is hard-deleted, taking the agent
			// session id the renderer's unread mark is keyed by with it.
			const closing = readTab(chatTabId);
			if (!closing) {
				return;
			}
			deps.chatTabService.closeTab({ chatTabId });
			deps.broadcastTabsChanged(
				toTabsChangedAfterClose(deps, {
					agentSessionId: closing.agentSessionId,
					chatTabId,
					isChat: closing.kind === 'chat',
					workspaceId: closing.workspaceId,
				}),
			);
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
			const tab = deps.chatTabService.openTab({
				kind,
				metadata,
				title: variant === 'comment' ? '' : fileTabTitle(filePath),
				workspaceId,
			});
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
				title: tab.title || UNNAMED_TAB_TITLE,
				workspaceId: tab.workspaceId,
				agentSessionId: tab.agentSessionId,
			}));
		},
		resolveTabWorkspace: async (chatTabId) => workspaceOfTab(chatTabId),
	};
}

/**
 * Builds the agent conversation port over the agent session service.
 * `agentSessionId` on the wire is the service's internal session id (stable
 * across the runtime id).
 * @param deps - Adapter collaborators.
 * @returns The conversation port.
 */
function makeConversationPort(deps: PortAdapterDeps): ConversationPort {
	/**
	 * The Pi snapshot every open request carries, gated by the same rule the
	 * renderer's own open uses: only a child that will actually run on Pi waits on
	 * Pi's binary, or an app with no Pi install could not delegate at all.
	 */
	const requireExecutableFor = async (runtime: AgentProviderId) => {
		const executable = await deps.piExecutableService.getSnapshot();
		if (isBlockedByPiExecutable({ executable, provider: runtime })) {
			throw new Error('Pi executable is unavailable.');
		}
		return executable;
	};

	/**
	 * The spawning agent's own identity: its persisted session row, plus the live
	 * model its bridge forwarded. Neither comes from the agent's own arguments —
	 * a terminal harness forwards no model and has no session row to read.
	 */
	const describeCaller = (input: {
		callerModel: string | undefined;
		callerRuntime: AgentProviderId | null;
		parentSessionId: string;
	}): SpawnCallerIdentity => {
		const session = deps.agentSessionService.getSession(input.parentSessionId);
		return {
			liveModelId: input.callerModel ?? null,
			runtime: input.callerRuntime,
			sessionModelId: session?.model ?? null,
			thinkingLevel: session?.thinkingLevel ?? null,
		};
	};

	return {
		listModels: async ({ runtime }): Promise<AgentControlModelList> => {
			const listing = await deps.spawnModelResolver.listModelsFor(runtime);
			return {
				defaultModelId: listing.defaultModelId,
				models: listing.models.map((model) => ({
					displayName: model.displayName,
					id: model.id,
					runtime: model.agentProvider,
					vendor: model.vendor,
				})),
				runtime: listing.runtime,
			};
		},
		startConversation: async ({
			workspaceId,
			workspaceCwd,
			chatTabId,
			prompt,
			model,
			thinkingLevel,
			title,
			callerModel,
			callerRuntime,
			parentSessionId,
			planMode,
		}) => {
			const resolution = await deps.spawnModelResolver.resolveForSpawn({
				caller: describeCaller({
					callerModel,
					callerRuntime,
					parentSessionId,
				}),
				requestedModelId: model ?? null,
				requestedThinkingLevel: thinkingLevel ?? null,
			});
			if (!resolution.ok) {
				return { ok: false, reason: resolution.reason };
			}
			const selection = resolution.selection;
			const executable = await requireExecutableFor(selection.runtime);
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
			const snapshot = await deps.agentSessionService.openSession({
				chatTabId: targetTabId,
				workspaceId,
				workspaceCwd,
				model: selection.modelId,
				// Without this the open falls through to the default runtime, which is
				// how a Claude orchestrator's children were created as Pi sessions
				// however the model resolved.
				provider: selection.runtime,
				thinkingLevel: selection.thinkingLevel,
				initialPrompt: prompt,
				executable,
				parentSessionId,
				// The registry below cannot be seeded until the session has an id, so
				// a runtime that gates on its starting permission mode would miss the
				// spawn entirely without the flag riding the open itself.
				planMode,
			});
			// Registered before `submitPrompt` because the child can reach
			// `before_agent_start` first.
			if (planMode) {
				deps.planMode.activateForSpawn(snapshot.id);
				deps.broadcastPlanMode({
					chatTabId: targetTabId,
					agentSessionId: snapshot.id,
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
				await deps.agentSessionService.submitPrompt({
					sessionId: snapshot.id,
					prompt,
					model: selection.modelId,
					provider: selection.runtime,
					thinkingLevel: selection.thinkingLevel,
				});
			} catch (error) {
				await rollbackConversation(deps, {
					agentSessionId: snapshot.id,
					openedTabId,
					markedTabId: markerApplied ? targetTabId : null,
					workspaceId,
				});
				throw error;
			}
			if (title) {
				await applyConversationName(deps, {
					name: title,
					agentSessionId: snapshot.id,
				});
			}
			deps.broadcastTabsChanged({ workspaceId });
			return { ok: true, chatTabId: targetTabId, agentSessionId: snapshot.id };
		},
		sendFollowUp: async ({ agentSessionId, prompt }) => {
			const streaming =
				deps.agentSessionService.getSession(agentSessionId)?.status ===
				'streaming';
			await deps.agentSessionService.submitPrompt({
				sessionId: agentSessionId,
				prompt,
				streamingBehavior: streaming ? 'followUp' : undefined,
			});
		},
		setName: async ({ agentSessionId, name }) => {
			const applied = await applyConversationName(deps, {
				name,
				agentSessionId,
			});
			if (applied?.applied) {
				const workspaceId =
					deps.agentSessionService.getSession(agentSessionId)?.workspaceId;
				if (workspaceId) {
					deps.broadcastTabsChanged({ workspaceId });
				}
			}
			return applied;
		},
		waitForIdle: async (agentSessionId, timeoutMs, signal) => {
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline && !signal?.aborted) {
				const status =
					deps.agentSessionService.getSession(agentSessionId)?.status;
				if (!status || IDLE_STATUSES.has(status)) {
					return 'completed';
				}
				await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
			}
			return 'timeout';
		},
		getStatus: async (agentSessionId) => {
			const snapshot = deps.agentSessionService.getSession(agentSessionId);
			if (!snapshot) {
				return null;
			}
			return {
				agentSessionId: snapshot.id,
				status: snapshot.status,
				runtimeOpen: snapshot.runtimeOpen,
			};
		},
		hasFinalMessage: async (agentSessionId) => {
			const snapshot = deps.agentSessionService.getSession(agentSessionId);
			if (!snapshot) {
				return false;
			}
			return findFinalTurnText(deps, snapshot.branchId) !== null;
		},
		getLastMessage: async (agentSessionId) => {
			const snapshot = deps.agentSessionService.getSession(agentSessionId);
			if (!snapshot) {
				return null;
			}
			return findFinalTurnText(deps, snapshot.branchId);
		},
		readTranscript: async ({ agentSessionId, ...page }) => {
			const snapshot = deps.agentSessionService.getSession(agentSessionId);
			return buildConversationTranscript({
				events: snapshot
					? deps.agentSessionService.listEvents(snapshot.branchId)
					: [],
				agentSessionId,
				...page,
			});
		},
		isSpawnedSubAgent: async (agentSessionId) =>
			readSubAgentMarker(deps, agentSessionId),
		resolveConversationWorkspace: async (agentSessionId) =>
			deps.agentSessionService.getSession(agentSessionId)?.workspaceId ?? null,
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
 * @param agentSessionId - The session whose tab to inspect.
 * @returns True when the session's tab is stamped as hosting a spawned sub-agent.
 */
function readSubAgentMarker(
	deps: PortAdapterDeps,
	agentSessionId: string,
): boolean {
	return isSessionTabMarkedSubAgent(
		deps.databaseService.getConnection()?.database,
		agentSessionId,
	);
}

/**
 * Describes a caller to the session-brief reader. A Concierge answers without
 * touching the database: it holds no chat tab and can never carry a sub-agent
 * marker, so both lookups would spend a query to learn what the origin already
 * says — and reporting a tab it does not have is what asks it for the naming
 * upkeep only a chat tab can do.
 * @param deps - Adapter collaborators.
 * @param origin - Resolved caller identity.
 * @returns The caller fields the brief consults.
 */
function briefCallerFor(
	deps: PortAdapterDeps,
	origin: AgentControlOrigin,
): SessionBriefCaller {
	return {
		hasChatTab: !origin.concierge && originHasChatTab(origin),
		isSubAgent:
			!origin.concierge &&
			resolveAgentRole(
				readSubAgentMarker(deps, origin.sessionId),
				origin.depth,
			) === 'subagent',
		sessionId: origin.sessionId,
		workspaceId: origin.workspaceId,
	};
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
	input: { agentSessionId: string; name: string },
): Promise<{ applied: boolean; chatTabId: string; title: string } | null> {
	try {
		return await deps.agentSessionService.setSessionName({
			name: input.name,
			provenance: 'agent',
			sessionId: input.agentSessionId,
		});
	} catch (cause) {
		console.warn('[agent-control] could not name a conversation tab.', {
			cause: cause instanceof Error ? cause.message : String(cause),
			agentSessionId: input.agentSessionId,
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
		agentSessionId: string;
		openedTabId: string | null;
		markedTabId: string | null;
		workspaceId: string;
	},
): Promise<void> {
	deps.planMode.releaseSession(target.agentSessionId);
	if (target.markedTabId) {
		writeSubAgentMarker(deps, target.markedTabId, null);
	}
	try {
		await deps.agentSessionService.stopSession({
			sessionId: target.agentSessionId,
			reason: 'agent-control-start-failed',
		});
	} catch (cause) {
		console.warn('[agent-control] could not stop a failed spawn.', {
			cause: cause instanceof Error ? cause.message : String(cause),
			agentSessionId: target.agentSessionId,
		});
	}
	if (target.openedTabId) {
		try {
			deps.chatTabService.closeTab({ chatTabId: target.openedTabId });
			deps.broadcastTabsChanged(
				toTabsChangedAfterClose(deps, {
					agentSessionId: target.agentSessionId,
					chatTabId: target.openedTabId,
					isChat: true,
					workspaceId: target.workspaceId,
				}),
			);
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
 * {@link MAX_AGENT_PAYLOAD_CHARS} and drops the oldest — the narration an agent writes
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
	for (const payload of deps.agentSessionService.iterateEventPayloadsDescending(
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
		const remaining = MAX_AGENT_PAYLOAD_CHARS - size;
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
	payload: AgentPersistedEnvelope | null | undefined,
): boolean {
	return payload?.kind === 'message' && payload.role === 'user';
}

/**
 * Extracts the assistant's visible answer from a persisted Pi event envelope.
 * Persisted events are {@link AgentPersistedEnvelope} tagged unions, so a completed
 * assistant turn is an `agent`-role `message` whose inner payload holds the
 * final text (as `message` parts or a standalone `text` payload). Reasoning
 * parts, tool calls, streaming deltas, and non-agent envelopes yield null, so a
 * final-turn scan collects only the answers the agent meant to leave behind.
 * @param payload - A persisted Pi event envelope, or null for a gap.
 * @returns The assistant text, or null when the event carries none.
 */
function extractAssistantText(
	payload: AgentPersistedEnvelope | null | undefined,
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
function messagePayloadText(payload: AgentWireMessagePayload): string {
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
 * Reads a terminal-service create result as a port outcome, keeping the
 * lifecycle diagnostic that explains a launch nobody got. The services report a
 * refusal as a session-less result rather than by throwing, so dropping the
 * diagnostics here is what would turn "no run script named playground" into a
 * successful-looking empty terminal id.
 * @param result - The create result from the terminal or script lifecycle service.
 * @param fallbackMessage - Message to report when the result carries no diagnostic.
 * @returns The started terminal, or the reason none started.
 */
function toStartTerminalOutcome(
	result: CreateTerminalSessionResult,
	fallbackMessage: string,
): StartTerminalOutcome {
	if (result.session) {
		return { ok: true, terminalId: result.session.id };
	}

	const diagnostic = result.diagnostics.at(0);

	return {
		ok: false,
		code: diagnostic?.code ?? 'terminal-not-started',
		message: diagnostic?.message ?? fallbackMessage,
		...(diagnostic?.terminalId && { terminalId: diagnostic.terminalId }),
	};
}

/**
 * Builds the terminal port over the terminal and script-lifecycle services.
 * @param deps - Adapter collaborators.
 * @returns The terminal port.
 */
function makeTerminalPort(deps: PortAdapterDeps): TerminalPort {
	return {
		startTerminal: async ({ workspaceId, kind, scriptName, restart }) => {
			if (kind === 'spawn') {
				return toStartTerminalOutcome(
					await deps.terminalService.create({
						kind: 'terminal',
						workspaceId,
					}),
					'The terminal could not be started.',
				);
			}

			return toStartTerminalOutcome(
				await deps.scriptLifecycleService.runScript({
					kind,
					restart: restart === true,
					scriptName: scriptName ?? null,
					workspaceId,
				}),
				`The ${kind} script could not be started.`,
			);
		},
		listRunScripts: async ({ workspaceId }) => {
			const scripts = deps.scriptLifecycleService.listRunScripts({
				workspaceId,
			});
			const fallback = selectDefaultRunScript(scripts);

			return {
				scripts: scripts.map((script) => ({
					command: script.command,
					isDefault: script.name === fallback?.name,
					name: script.name,
				})),
			};
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
		readOutput: async ({ terminalId, ansi }) => {
			const scrollback =
				deps.terminalService.getSnapshot(terminalId).scrollback ?? null;
			if (scrollback === null || ansi) {
				return scrollback;
			}
			return toReadableScrollback(scrollback) || null;
		},
		listTerminals: async ({
			workspaceId,
		}): Promise<readonly AgentControlTerminalInfo[]> =>
			deps.terminalService.list(workspaceId).map((session) => ({
				terminalId: session.id,
				kind: session.kind,
				scriptName: session.scriptName ?? null,
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
		focusWorkspace: ({ workspaceId }) =>
			deps.broadcastFocus({ workspaceId, target: { kind: 'workspace' } }),
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
 * `agent-runtime/naming/`; this stays wiring — resolve the database and the user's
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
				caller: briefCallerFor(deps, origin),
				database: deps.databaseService.getConnection()?.database,
				namingEnabled,
			}),
		setBranchName: async ({ origin, slug, userRequested }) => {
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
				userRequested,
				workspaceId: origin.workspaceId,
			});
			if (result.applied && originHasChatTab(origin)) {
				deps.agentSessionService.appendWorkspaceRenamed(origin.sessionId);
			}
			if (result.applied) {
				deps.broadcastTabsChanged({ workspaceId: origin.workspaceId });
			}
			return result;
		},
		setSummary: async ({ origin, summary, title }) => {
			const recorded = deps.agentSessionService.setSessionSummary({
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
		diff: makeDiffPort(deps),
		review: makeReviewPort(deps),
		linear: makeLinearPort(deps),
		sessionNaming: makeSessionNamingPort(deps),
		permissions: { getMode: () => deps.getPermissionMode() },
		language: { getLanguage: () => deps.getLanguage() },
		confirm: deps.confirm,
		ask: deps.ask,
		planMode: deps.planMode,
		...(deps.conciergePorts ?? {}),
	};
}
