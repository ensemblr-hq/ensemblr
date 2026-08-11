import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { listChatTabsQuery } from '@/renderer/api/ensemblr-queries';
import { useWorkbenchLayoutRouteModelOptional } from '@/renderer/components/workbench-shell/shell-contexts';
import { findWorkspaceSelectionById } from '@/renderer/lib/workbench';
import {
	type UnreadChatEntry,
	useUnreadChatActions,
} from '@/renderer/state/unread';

/**
 * Finds which tab a session sits in for a workspace the renderer has not opened,
 * where no tab list is in memory. Returns null when the lookup fails or the
 * session no longer has an open tab, leaving the caller to fall back to the
 * workspace's own preferred chat.
 * @param queryClient - Cache the tab list is fetched through
 * @param target - The unread mark being jumped to
 * @returns The chat tab id, or null
 */
async function resolveChatTabId(
	queryClient: QueryClient,
	target: UnreadChatEntry,
): Promise<string | null> {
	try {
		const result = await queryClient.fetchQuery(
			listChatTabsQuery(target.workspaceId),
		);
		const tab = result.open.find(
			(candidate) => candidate.agentSessionId === target.agentSessionId,
		);
		return tab?.id ?? null;
	} catch {
		return null;
	}
}

/**
 * Returns a callback that opens the chat behind an unread mark, crossing into
 * another workspace when that is where it lives.
 *
 * A mark made while its workspace was closed carries no tab id, because the
 * session-to-tab mapping only exists for a workspace whose tabs are loaded. That
 * one lookup is paid here, on click, rather than on every streamed event. When
 * it comes back empty — the tab was closed since — the workspace still opens, on
 * its own preferred chat.
 *
 * Both dead ends drop the mark rather than leaving it. Only opening the chat
 * itself clears one otherwise, so a mark whose tab or workspace is gone would
 * pin the jump control open forever on something the user cannot reach.
 * @returns A callback taking the unread mark to jump to.
 */
export function useNavigateToLastUnread(): (
	target: UnreadChatEntry,
) => Promise<void> {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const layoutModel = useWorkbenchLayoutRouteModelOptional();
	const { clearChat } = useUnreadChatActions();

	return useCallback(
		async (target: UnreadChatEntry) => {
			if (!layoutModel) {
				return;
			}
			const selection = findWorkspaceSelectionById(
				layoutModel.displayProjects,
				target.workspaceId,
			);
			if (!selection) {
				clearChat(target);
				return;
			}

			const chatId =
				target.chatTabId ?? (await resolveChatTabId(queryClient, target));
			if (!chatId) {
				clearChat(target);
				layoutModel.navigateToWorkspace(
					selection.project.id,
					selection.workspace.id,
				);
				return;
			}

			navigate({
				params: {
					chatId,
					projectId: selection.project.id,
					workspaceId: selection.workspace.id,
				},
				search: layoutModel.resolveWorkspaceRouteSearch(selection.workspace),
				to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
			});
		},
		[clearChat, layoutModel, navigate, queryClient],
	);
}
