import { type QueryClient, useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';

import {
	ensemblrQueryKeys,
	pinChatTab,
	writeOpenedChatTabToCache,
} from '@/renderer/api/ensemblr-queries';
import type { SessionTabModel } from '@/renderer/types/workbench';

/**
 * Renderer half of the ephemeral preview slot: promotes the tab holding the
 * slot to a permanent one so the next previewed subject opens beside it rather
 * than replacing it. Split out of `useSessionTabState` so the pin mutation, its
 * cache write, and the already-permanent guard live behind one callback.
 * @param options - The query client, the workspace's tab models, its id, and the shared chat-tab invalidator
 * @returns The pin callback the tab strip and reorder handler drive
 */
export function usePreviewTabSlot({
	invalidateChatTabs,
	queryClient,
	sessionTabs,
	workspaceId,
}: {
	invalidateChatTabs: () => void;
	queryClient: QueryClient;
	sessionTabs: readonly SessionTabModel[];
	workspaceId: string;
}): { pinSessionTab: (chatTabId: string) => void } {
	const pinChatTabMutation = useMutation({
		mutationFn: (chatTabId: string) => pinChatTab({ chatTabId }),
		onError: (error) => {
			invalidateChatTabs();
			toast.error('Could not keep tab open', {
				description: error instanceof Error ? error.message : undefined,
			});
		},
		onSuccess: (result) => {
			if (result.tab) {
				writeOpenedChatTabToCache({
					queryClient,
					tab: result.tab,
					workspaceId,
				});
			}
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.chatTabs(workspaceId),
			});
		},
	});

	const pinSessionTab = useCallback(
		(chatTabId: string) => {
			const target = sessionTabs.find((session) => session.id === chatTabId);
			if (!target?.isPreview) {
				return;
			}
			pinChatTabMutation.mutate(chatTabId);
		},
		[pinChatTabMutation, sessionTabs],
	);

	return { pinSessionTab };
}
