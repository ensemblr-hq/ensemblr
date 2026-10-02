import { useAtom } from 'jotai';
import { useEffect } from 'react';

import { useNavigateToLastUnread } from '@/renderer/hooks/workbench-shell/composer/use-navigate-to-last-unread';
import { pendingNotificationFocusAtom } from '@/renderer/state/unread';

/**
 * Opens the chat behind a clicked desktop notification, crossing into another
 * workspace when that is where it lives.
 *
 * Renders nothing — it exists to drain one request for the whole shell. The
 * click itself is taken at the app root by `useNotificationFocusSync`, which
 * parks it here, so a click that arrives while settings are open still lands
 * once the shell is back. Draining on mount rather than on an event is what
 * makes that second case work.
 *
 * A notification is also the one focus request that routinely names a workspace
 * this window is not showing, so it deliberately does not go through the
 * agent-control focus path, which drops anything outside the open workspace.
 * The jump itself is `useNavigateToLastUnread`, which already resolves a missing
 * tab id, falls back to the workspace's preferred chat, and clears the unread
 * mark on arrival.
 */
export function NotificationFocusBridge() {
	const navigateToChat = useNavigateToLastUnread();
	const [pendingFocus, setPendingFocus] = useAtom(pendingNotificationFocusAtom);

	useEffect(() => {
		if (!pendingFocus) {
			return;
		}
		setPendingFocus(null);
		void navigateToChat(pendingFocus);
	}, [navigateToChat, pendingFocus, setPendingFocus]);

	return null;
}
