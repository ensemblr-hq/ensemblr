import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';

import {
	ensemblrQueryKeys,
	reorderChatTabs,
	writeReorderedChatTabsToCache,
} from '@/renderer/api/ensemblr-queries';
import { areStringArraysEqual } from '@/renderer/lib/ordered-ids';
import type { SessionTabModel } from '@/renderer/types/workbench';
import type { ListChatTabsResult } from '@/shared/ipc/contracts/chat-tab';

import { usePreviewTabSlot } from './preview-tab-slot';

/**
 * Persists a drag-and-drop tab order when it differs from the current model.
 *
 * Dragging the preview tab pins it on the way: placing a tab deliberately means
 * keeping it, so the next preview must not take it. Tabs the drag only pushed
 * aside keep their preview state — their index moved, the user's intent did not.
 * @param invalidateChatTabs - Refetches the tab list when the write fails
 * @param sessionTabs - The workspace's current tabs, in their persisted order
 * @param workspaceId - Workspace whose tab order is being written
 * @returns The reorder callback the tab strip commits a finished drag through,
 * plus the pin that keeps a deliberately placed tab out of the preview slot
 */
export function useSessionTabReorder({
	invalidateChatTabs,
	sessionTabs,
	workspaceId,
}: {
	invalidateChatTabs: () => void;
	sessionTabs: SessionTabModel[];
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const { pinSessionTab } = usePreviewTabSlot({
		invalidateChatTabs,
		queryClient,
		sessionTabs,
		workspaceId,
	});

	const reorderChatTabsMutation = useMutation({
		mutationFn: (orderedIds: readonly string[]) =>
			reorderChatTabs({ orderedIds, workspaceId }),
		onError: (error) => {
			invalidateChatTabs();
			toast.error('Could not reorder tabs', {
				description: error instanceof Error ? error.message : undefined,
			});
		},
		onMutate: (orderedIds: readonly string[]) => {
			writeReorderedChatTabsToCache({
				orderedIds,
				queryClient,
				workspaceId,
			});
		},
		onSuccess: (result) => {
			queryClient.setQueryData<ListChatTabsResult>(
				ensemblrQueryKeys.chatTabs(workspaceId),
				(current) => ({
					closed: current?.closed ?? [],
					open: result.open,
				}),
			);
		},
	});

	const reorderSessionTabs = useCallback(
		(sessionIds: string[], draggedSessionId: string) => {
			const currentIds = sessionTabs.map((session) => session.id);
			const currentIdSet = new Set(currentIds);
			const nextIds = sessionIds.filter((sessionId) =>
				currentIdSet.has(sessionId),
			);

			if (
				nextIds.length !== currentIds.length ||
				areStringArraysEqual(nextIds, currentIds)
			) {
				return;
			}

			pinSessionTab(draggedSessionId);
			reorderChatTabsMutation.mutate(nextIds);
		},
		[pinSessionTab, reorderChatTabsMutation, sessionTabs],
	);

	return { pinSessionTab, reorderSessionTabs };
}
