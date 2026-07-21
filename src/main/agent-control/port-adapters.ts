/**
 * Concrete {@link AgentControlPorts} built over the real main-process services.
 * This is the only place that knows how each control op maps onto chat-tab, Pi
 * session, terminal, script, and harness internals; the service and guardrails
 * stay ignorant of those details. Kept as thin delegation so it is obvious which
 * existing call each op reuses.
 */

import type {
	AgentControlConversationStatus,
	AgentControlModelList,
	AgentControlTabInfo,
	AgentControlTerminalInfo,
	AgentControlWorkspaceInfo,
	FocusViewBroadcast,
	TabsChangedBroadcast,
} from '../../shared/agent-control.ts';
import { findHarnessDefinition } from '../../shared/agents/harness-registry.ts';
import type { PermissionMode } from '../../shared/permissions.ts';
import type { HarnessDetectionService } from '../agents/harness-detection-service.ts';
import type { ChatTabService } from '../chat-tabs/chat-tab-service.ts';
import type { LocalCommandService } from '../commands';
import type { PiSessionService } from '../pi-agent/pi-session-service.ts';
import type { PiExecutableService } from '../pi-runtime';
import {
	presentPiModels,
	resolvePiProviderModels,
} from '../pi-runtime/pi-provider-models.ts';
import type { ScriptLifecycleService } from '../scripts/script-lifecycle-service.ts';
import type { EnsemblrDatabaseService } from '../storage';
import {
	getChatTabById,
	setChatTabMetadata,
} from '../storage/repositories/chat-tab-repository.ts';
import { listAllWorkspaceRows } from '../storage/repositories/workspace-repository.ts';
import type { TerminalService } from '../terminal';
import type {
	AgentControlPorts,
	ConfirmPort,
	ConversationPort,
	FocusPort,
	HarnessPort,
	TabPort,
	TerminalPort,
	WorkspacePort,
} from './ports.ts';

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
	getPermissionMode: () => PermissionMode;
	/** Appends agent-control MCP-config flags to a harness launch command. */
	augmentHarnessCommand: (
		command: string,
		harnessId: string,
		workspaceId: string,
	) => string;
	/** Broadcasts a focus request to the renderer window showing the workspace. */
	broadcastFocus: (payload: FocusViewBroadcast) => void;
	/** Broadcasts a tab-set change so the renderer refreshes its tab list. */
	broadcastTabsChanged: (payload: TabsChangedBroadcast) => void;
	confirm: ConfirmPort;
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
		} catch {
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
			callerModel,
			parentSessionId,
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
					workspaceId,
				});
				throw error;
			}
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
		getStatus: async (
			piSessionId,
		): Promise<AgentControlConversationStatus | null> => {
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
		getLastMessage: async (piSessionId) => {
			const snapshot = deps.piSessionService.getSession(piSessionId);
			if (!snapshot) {
				return null;
			}
			const events = deps.piSessionService.listEvents(snapshot.branchId);
			for (let i = events.length - 1; i >= 0; i -= 1) {
				const text = extractAssistantText(events[i]?.payload);
				if (text) {
					return text;
				}
			}
			return null;
		},
		resolveConversationWorkspace: async (piSessionId) =>
			deps.piSessionService.getSession(piSessionId)?.workspaceId ?? null,
	};
}

/**
 * Tears down a conversation that failed to submit its first prompt, so a throw
 * mid-`startConversation` does not strand a live Pi session or an empty chat
 * tab. Best-effort: cleanup errors are swallowed so the original failure is the
 * one surfaced to the caller.
 * @param deps - Adapter collaborators.
 * @param target - The session to stop, the tab this call opened (if any), and its workspace.
 */
async function rollbackConversation(
	deps: PortAdapterDeps,
	target: {
		piSessionId: string;
		openedTabId: string | null;
		workspaceId: string;
	},
): Promise<void> {
	try {
		await deps.piSessionService.stopSession({
			sessionId: target.piSessionId,
			reason: 'agent-control-start-failed',
		});
	} catch {
		// The session may never have started streaming; ignore stop failures.
	}
	if (target.openedTabId) {
		try {
			deps.chatTabService.closeTab({ chatTabId: target.openedTabId });
			deps.broadcastTabsChanged({ workspaceId: target.workspaceId });
		} catch {
			// Tab may already be gone; the caller's error still propagates.
		}
	}
}

/**
 * Best-effort extraction of assistant text from a persisted Pi event payload.
 * Returns null when the payload is not an assistant message with text.
 * @param payload - Persisted event payload of unknown shape.
 * @returns The assistant text, or null.
 */
function extractAssistantText(payload: unknown): string | null {
	if (!payload || typeof payload !== 'object') {
		return null;
	}
	const message = (payload as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		return null;
	}
	const record = message as { role?: unknown; content?: unknown };
	if (record.role !== 'assistant' || !Array.isArray(record.content)) {
		return null;
	}
	const text = record.content
		.filter(
			(block): block is { type: 'text'; text: string } =>
				typeof block === 'object' &&
				block !== null &&
				(block as { type?: unknown }).type === 'text' &&
				typeof (block as { text?: unknown }).text === 'string',
		)
		.map((block) => block.text)
		.join('');
	return text.length > 0 ? text : null;
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
		permissions: { getMode: () => deps.getPermissionMode() },
		confirm: deps.confirm,
	};
}
