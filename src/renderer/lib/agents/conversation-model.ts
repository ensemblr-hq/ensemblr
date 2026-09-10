import type { DynamicToolUIPart } from 'ai';

import { presentToolCall } from '@/renderer/lib/agent-timeline/tool-presentation';
import { i18n } from '@/renderer/lib/i18n';
import type { AgentConversationLiveState } from '@/renderer/state/agents';
import { toComposerContextUsage } from '@/renderer/state/composer/agent-session-event-sync';
import type { AgentConversation } from '@/renderer/types/agents';
import type { AgentSessionLineage } from '@/shared/agent-control';
import type { AgentModelCatalog } from '@/shared/ipc/contracts/agent-models';
import type { AgentSessionSnapshotWire } from '@/shared/ipc/contracts/agent-session';
import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';
import { sessionTabHolderIds } from './session-tab-holder';

/** Returns a compact user-facing target from a prepared tool presentation. */
function activityTarget(
	presentation: ReturnType<typeof presentToolCall>,
): string | null {
	const badge = presentation.badge;
	if (badge?.kind === 'file' || badge?.kind === 'folder') {
		return badge.path;
	}
	if (badge?.kind === 'workspace') {
		return badge.workspaceId;
	}
	if (badge?.kind === 'chat') {
		return badge.chatTabId;
	}
	return presentation.preview?.text ?? null;
}

/** Projects the first unresolved tool call through the shared timeline presenter. */
function activityOf(
	live: AgentConversationLiveState | undefined,
): AgentConversation['activity'] {
	const tools = live?.activity.currentTools ?? [];
	const tool = tools[0];
	if (!tool) {
		return null;
	}
	const part: DynamicToolUIPart & {
		toolPresentation?: typeof tool.presentation;
	} = {
		input: tool.input,
		state: 'input-available',
		toolCallId: tool.toolCallId,
		toolName: tool.name,
		toolPresentation: tool.presentation,
		type: 'dynamic-tool',
	};
	const presentation = presentToolCall(part);
	return {
		parallelCount: tools.length,
		target: activityTarget(presentation),
		title: presentation.title,
	};
}

const KNOWN_MODEL_VENDOR_PREFIXES = new Set([
	'anthropic',
	'claude-code',
	'google',
	'lmstudio',
	'nvidia-nim',
	'openai',
	'openai-codex',
]);

/** Removes a recognized inference-provider segment without rewriting the model id. */
function modelIdWithoutProvider(
	modelId: string,
	catalog: AgentModelCatalog | undefined,
): string {
	const separator = modelId.indexOf('/');
	if (separator < 1 || separator === modelId.length - 1) {
		return modelId;
	}
	const prefix = modelId.slice(0, separator);
	const isKnownPrefix =
		KNOWN_MODEL_VENDOR_PREFIXES.has(prefix) ||
		catalog?.models.some((model) => model.vendor === prefix) === true;
	return isKnownPrefix ? modelId.slice(separator + 1) : modelId;
}

/** Resolves a session model through the existing formatted model catalogue. */
function modelLabel(
	session: AgentSessionSnapshotWire | undefined,
	catalog: AgentModelCatalog | undefined,
): string | null {
	if (!session?.model) {
		return null;
	}
	return (
		catalog?.models.find(
			(model) =>
				model.id === session.model && model.agentProvider === session.provider,
		)?.displayName ?? modelIdWithoutProvider(session.model, catalog)
	);
}

/** Maps a persisted chat and optional live session into a localized Agents row.
 * @param options - Chat identity, runtime readings, lineage, model catalogue, and display language.
 * @returns Conversation with a nonempty title even before the agent names its tab.
 */
function conversationOf({
	blocked,
	catalog,
	language,
	lineage,
	live,
	session,
	tab,
}: {
	blocked: boolean;
	catalog: AgentModelCatalog | undefined;
	language: string;
	lineage: AgentSessionLineage | undefined;
	live: AgentConversationLiveState | undefined;
	session: AgentSessionSnapshotWire | undefined;
	tab: ChatTabWire;
}): AgentConversation {
	const isClosed = tab.closedAt !== null;
	const context = live?.contextUsage ?? session?.contextUsage ?? null;
	const runtimeStatus = live?.status ?? session?.status;
	const status = blocked
		? 'blocked'
		: runtimeStatus === 'starting' || runtimeStatus === 'streaming'
			? 'working'
			: 'idle';
	return {
		activity: isClosed ? null : activityOf(live),
		chatTabId: tab.id,
		contextUsage: context
			? { ...toComposerContextUsage(context.usage), reading: context.reading }
			: null,
		depth: lineage?.depth ?? (tab.metadata.parentChatTabId ? 1 : 0),
		isClosed,
		model: modelLabel(session, catalog),
		parentChatTabId: null,
		runtime: session?.provider ?? null,
		status,
		title:
			tab.fullTitle.trim() ||
			tab.title.trim() ||
			(isClosed
				? i18n.t('workbench:session-tabs.untitled-closed', 'Untitled chat', {
						lng: language,
					})
				: i18n.t('workbench:session-tabs.untitled', 'New chat', {
						lng: language,
					})),
	};
}

/**
 * Builds stable session-backed Agents rows and resolves session lineage to chat ids.
 * A fresh chat has no agent-session foreign key until its first submission opens one.
 * @param options - Workspace chats, session state, lineage, and display language.
 * @returns Session-backed conversations with localized fallback titles and resolved parents.
 */
export function toAgentConversations({
	blockedSessionIds,
	catalog,
	closedTabs,
	language,
	lineageBySessionId,
	liveBySessionId,
	openTabs,
	sessions,
}: {
	blockedSessionIds: ReadonlySet<string>;
	catalog: AgentModelCatalog | undefined;
	closedTabs: readonly ChatTabWire[];
	language: string;
	lineageBySessionId: ReadonlyMap<string, AgentSessionLineage>;
	liveBySessionId: Readonly<Record<string, AgentConversationLiveState>>;
	openTabs: readonly ChatTabWire[];
	sessions: readonly AgentSessionSnapshotWire[];
}): AgentConversation[] {
	const sessionById = new Map(sessions.map((session) => [session.id, session]));
	const openSessionTabs = openTabs.filter(
		(tab) => tab.kind === 'chat' && tab.agentSessionId !== null,
	);
	const closedSessionTabs = closedTabs
		.filter((tab) => tab.kind === 'chat' && tab.agentSessionId !== null)
		.sort((left, right) =>
			(right.closedAt ?? '').localeCompare(left.closedAt ?? ''),
		);
	const allTabs = [...openSessionTabs, ...closedSessionTabs];
	const chatTabIdBySessionId = sessionTabHolderIds({
		closedTabs: closedSessionTabs,
		openTabs: openSessionTabs,
	});
	return allTabs.map((tab) => {
		const sessionId = tab.agentSessionId ?? '';
		const lineage = lineageBySessionId.get(sessionId);
		const conversation = conversationOf({
			blocked: blockedSessionIds.has(sessionId),
			catalog,
			language,
			lineage,
			live: liveBySessionId[sessionId],
			session: sessionById.get(sessionId),
			tab,
		});
		const legacyParent =
			typeof tab.metadata.parentChatTabId === 'string'
				? tab.metadata.parentChatTabId
				: null;
		return {
			...conversation,
			parentChatTabId: lineage
				? lineage.parentSessionId
					? (chatTabIdBySessionId.get(lineage.parentSessionId) ?? null)
					: null
				: legacyParent,
		};
	});
}
