import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	agentModelsQuery,
	agentSessionsForWorkspaceQuery,
	ensemblrQueryKeys,
	listChatTabsQuery,
	subscribeAgentSessionEvents,
} from '@/renderer/api/ensemblr-queries';
import { toAgentConversations } from '@/renderer/lib/agents/conversation-model';
import { pendingAskUserQuestionsAtom } from '@/renderer/state/ask-user-question';
import { pendingToolApprovalsAtom } from '@/renderer/state/tool-approval';
import type {
	AgentConversation,
	AgentsPanelProps,
} from '@/renderer/types/agents';
import type { AgentSessionLineage } from '@/shared/agent-control';
import type { AgentSessionSnapshotWire } from '@/shared/ipc/contracts/agent-session';
import {
	agentWorkspaceLiveStateAtomFamily,
	applyAgentConversationEventAtom,
	seedAgentConversationSnapshotsAtom,
} from './atoms';

const EMPTY_SESSIONS: readonly AgentSessionSnapshotWire[] = [];

/** Production Agents panel state and navigation backed by workspace snapshots. */
export function useAgentsPanelState({
	onDismiss,
	onRestore,
	onSelect,
	selectedChatTabId,
	workspaceId,
}: {
	onDismiss: () => void;
	onRestore: (chatTabId: string) => Promise<boolean>;
	onSelect: (chatTabId: string) => void;
	selectedChatTabId: string | null;
	workspaceId: string;
}): AgentsPanelProps {
	const { i18n } = useTranslation();
	const language = i18n.language;
	const queryClient = useQueryClient();
	const tabsQuery = useQuery(listChatTabsQuery(workspaceId));
	const sessionsQuery = useQuery(agentSessionsForWorkspaceQuery(workspaceId));
	const modelsQuery = useQuery(agentModelsQuery);
	const pendingQuestions = useAtomValue(pendingAskUserQuestionsAtom);
	const pendingApprovals = useAtomValue(pendingToolApprovalsAtom);
	const liveBySessionId = useAtomValue(
		agentWorkspaceLiveStateAtomFamily(workspaceId),
	);
	const seedSnapshots = useSetAtom(seedAgentConversationSnapshotsAtom);
	const applyEvent = useSetAtom(applyAgentConversationEventAtom);
	const [restoreStates, setRestoreStates] = useState<
		Readonly<Record<string, 'error' | 'pending'>>
	>({});
	const sessions = sessionsQuery.data?.sessions ?? EMPTY_SESSIONS;

	useEffect(() => {
		seedSnapshots({ sessions, workspaceId });
	}, [seedSnapshots, sessions, workspaceId]);

	useEffect(
		() =>
			subscribeAgentSessionEvents((broadcast) => {
				if (
					broadcast.workspaceId !== workspaceId ||
					broadcast.event.payload === null
				) {
					return;
				}
				applyEvent({
					branchId: broadcast.event.branchId,
					envelope: broadcast.event.payload,
					ordinal: broadcast.event.ordinal,
					sessionId: broadcast.sessionId,
					workspaceId,
				});
			}),
		[applyEvent, workspaceId],
	);

	/** Refetches the two workspace snapshots required by the panel. */
	const retry = useCallback(() => {
		void Promise.all([
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
			}),
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.agentSessionsForWorkspace(workspaceId),
			}),
		]);
	}, [queryClient, workspaceId]);
	/** Selects an open conversation and reveals it behind a narrow sheet. */
	const select = useCallback(
		(chatTabId: string) => {
			onSelect(chatTabId);
			onDismiss();
		},
		[onDismiss, onSelect],
	);
	/** Restores a closed conversation while preserving a retryable failure row. */
	const restore = useCallback(
		(chatTabId: string) => {
			setRestoreStates((current) => ({
				...current,
				[chatTabId]: 'pending',
			}));
			void onRestore(chatTabId).then((restored) => {
				if (restored) {
					setRestoreStates((current) => {
						const next = { ...current };
						delete next[chatTabId];
						return next;
					});
					onDismiss();
					return;
				}
				setRestoreStates((current) => ({
					...current,
					[chatTabId]: 'error',
				}));
			});
		},
		[onDismiss, onRestore],
	);

	const conversations = useMemo<AgentConversation[]>(() => {
		const blockedSessionIds = new Set([
			...Object.keys(pendingQuestions),
			...Object.keys(pendingApprovals),
		]);
		const lineageBySessionId = new Map<string, AgentSessionLineage>();
		for (const session of sessions) {
			if (session.lineage) {
				lineageBySessionId.set(session.id, session.lineage);
			}
		}
		return toAgentConversations({
			blockedSessionIds,
			catalog: modelsQuery.data,
			closedTabs: tabsQuery.data?.closed ?? [],
			language,
			lineageBySessionId,
			liveBySessionId,
			openTabs: tabsQuery.data?.open ?? [],
			sessions,
		}).map((conversation) => ({
			...conversation,
			...(restoreStates[conversation.chatTabId]
				? { restoreState: restoreStates[conversation.chatTabId] }
				: {}),
		}));
	}, [
		language,
		liveBySessionId,
		modelsQuery.data,
		pendingApprovals,
		pendingQuestions,
		restoreStates,
		sessions,
		tabsQuery.data,
	]);

	return {
		conversations,
		onRestore: restore,
		onRetry: retry,
		onSelect: select,
		selectedChatTabId,
		state:
			tabsQuery.isError || sessionsQuery.isError
				? 'error'
				: tabsQuery.isPending || sessionsQuery.isPending
					? 'loading'
					: 'ready',
	};
}
