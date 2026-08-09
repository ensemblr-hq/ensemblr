import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	ensemblrQueryKeys,
	openChatTab,
	writeOpenedChatTabToCache,
} from '@/renderer/api/ensemblr-queries';
import { useAgentSessionStatusInvalidation } from '@/renderer/hooks/workspace/use-agent-session-status-invalidation';
import type {
	ChatTabWire,
	OpenChatTabRequest,
} from '@/shared/ipc/contracts/chat-tab';

/**
 * The two mutations that persist a new tab row, plus the cache invalidation
 * every tab change funnels through.
 *
 * Chat tabs and auxiliary tabs (file, diff, document, terminal) differ only in
 * how a failure surfaces: a failed chat open is silent because the caller
 * already treats it as a no-op, while a failed auxiliary open is worth a toast
 * because the user asked for that exact tab.
 * @param insertAnchorTabId - Tab an auxiliary tab lands after, or null to append
 * @param workspaceId - Workspace the tabs belong to
 * @returns The invalidation callback and the two open mutations
 */
export function useChatTabOpenMutations({
	insertAnchorTabId,
	workspaceId,
}: {
	insertAnchorTabId: string | null;
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const { t } = useTranslation();

	const invalidateChatTabs = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
		});
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.closedChatTabsWithSummary(workspaceId),
		});
		// The timeline resolves a tab's branch id out of the session list, so a tab
		// that just gained an agent session has no branch to query until this
		// refetches.
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.agentSessionsForWorkspace(workspaceId),
		});
	}, [queryClient, workspaceId]);

	// Refresh the agent session list on status events across ALL sessions in this
	// workspace so inactive-tab spinners update. The composer-bound subscription
	// filters to one session id and would otherwise miss background-tab changes.
	useAgentSessionStatusInvalidation(workspaceId);

	// An agent opening or closing a tab (main → renderer) is invisible to the
	// tab list, which is a cached query only invalidated by renderer-local
	// mutations. Invalidate on the broadcast so an agent-created tab appears at
	// once instead of lingering until an unrelated refetch.
	useEffect(() => {
		const unsubscribe = window.ensemblr?.onAgentControlTabsChanged(
			(broadcast) => {
				if (broadcast.workspaceId !== workspaceId) {
					return;
				}
				invalidateChatTabs();
			},
		);
		return unsubscribe;
	}, [invalidateChatTabs, workspaceId]);

	const cacheOpenedTab = useCallback(
		(result: { tab: ChatTabWire }) => {
			writeOpenedChatTabToCache({
				queryClient,
				tab: result.tab,
				workspaceId,
			});
			invalidateChatTabs();
		},
		[invalidateChatTabs, queryClient, workspaceId],
	);

	const openChatTabMutation = useMutation({
		mutationFn: (request?: Omit<OpenChatTabRequest, 'workspaceId'>) =>
			openChatTab({ ...request, workspaceId }),
		onError: () => {
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.closedChatTabsWithSummary(workspaceId),
			});
		},
		onSuccess: (result) => {
			cacheOpenedTab(result);
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
			});
		},
	});

	const openAuxiliaryTabMutation = useMutation({
		mutationFn: (
			request: Omit<OpenChatTabRequest, 'insertAfterChatTabId' | 'workspaceId'>,
		) =>
			openChatTab({
				...request,
				insertAfterChatTabId: insertAnchorTabId,
				workspaceId,
			}),
		onError: (error) => {
			invalidateChatTabs();
			toast.error(
				t('errors:chat-tab.open-failed.title', 'Could not open tab'),
				{
					description: error instanceof Error ? error.message : undefined,
				},
			);
		},
		onSuccess: (result) => {
			cacheOpenedTab(result);
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
			});
		},
	});

	return { invalidateChatTabs, openAuxiliaryTabMutation, openChatTabMutation };
}
