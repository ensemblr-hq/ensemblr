import { useEffect } from 'react';

import { subscribeNotificationSoundRequests } from '@/renderer/api/ensemblr';
import { playNotificationSound } from '@/renderer/lib/notification-sound';

/**
 * Plays the notification chime whenever the main process raises a desktop
 * notification that should be audible. Mount once at the app root.
 *
 * It belongs at the root rather than in the workbench shell because main
 * silences the OS notification and relies on this listener for the only sound
 * the user gets. `/settings` is a sibling of the shell route, not a descendant,
 * so a shell-scoped listener would leave the settings screen — where the switch
 * itself lives — with no sound at all.
 *
 * It applies no gate of its own: main has already checked that the chat is not
 * the one on screen, that it is not a sub-agent's, and that both the
 * desktop-notification and notification-sound settings are on.
 */
export function useNotificationSoundSync(): void {
	useEffect(
		() => subscribeNotificationSoundRequests(playNotificationSound),
		[],
	);
}
