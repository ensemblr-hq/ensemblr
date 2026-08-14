import { useEffect, useRef } from 'react';

import { subscribeFocusChatRequests } from '@/renderer/api/ensemblr';
import { useNavigateToLastUnread } from '@/renderer/hooks/workbench-shell/composer/use-navigate-to-last-unread';

/**
 * Opens the chat behind a clicked desktop notification, crossing into another
 * workspace when that is where it lives.
 *
 * Renders nothing — it exists to hold one subscription for the whole shell. A
 * notification is the one focus request that routinely names a workspace this
 * window is not showing, so it deliberately does not go through the
 * agent-control focus path, which drops anything outside the open workspace.
 *
 * The jump itself is `useNavigateToLastUnread`, which already resolves a
 * missing tab id, falls back to the workspace's preferred chat, and clears the
 * unread mark on arrival. Subscribing once and calling through a ref keeps the
 * listener stable while that callback's identity changes with the layout model.
 */
export function NotificationFocusBridge() {
	const navigateToChat = useNavigateToLastUnread();
	const navigateRef = useRef(navigateToChat);

	useEffect(() => {
		navigateRef.current = navigateToChat;
	}, [navigateToChat]);

	useEffect(
		() =>
			subscribeFocusChatRequests((payload) => {
				void navigateRef.current({
					agentSessionId: payload.agentSessionId,
					chatTabId: payload.chatTabId,
					workspaceId: payload.workspaceId,
				});
			}),
		[],
	);

	return null;
}
