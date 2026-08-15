/** How many shown notifications stay clickable before the oldest is let go. */
const MAX_RETAINED_NOTIFICATIONS = 64;

/**
 * The slice of Electron's `Notification` a retainer needs, so it stays testable.
 * The three events are spelled out rather than taking a union, because Electron
 * types `on` as overloads and an overloaded method cannot be called with one.
 */
export interface RetainableNotification {
	on: {
		(event: 'click', listener: () => void): unknown;
		(event: 'close', listener: () => void): unknown;
		(event: 'failed', listener: () => void): unknown;
	};
}

/** Holds shown notifications alive and reports how many it is still holding. */
export interface NotificationRetainer {
	retain: (notification: RetainableNotification) => void;
	size: () => number;
}

/**
 * Keeps shown notifications reachable so their click handlers survive.
 *
 * Electron ties a notification's lifetime to its JavaScript object: once V8
 * collects it, the `click` listener goes with it and macOS drops the banner out
 * of Notification Center. A turn that finishes while the user is in another app
 * is exactly the case where the click lands minutes later, so the reference has
 * to outlive the call that showed it.
 *
 * macOS never reports a notification the user simply ignored, so the registry
 * would otherwise grow for as long as the app runs. Past the cap the oldest is
 * released — a notification that far down Notification Center has been sitting
 * there through sixty-odd newer ones.
 * @param limit - How many notifications to hold; defaults to the module cap.
 * @returns A retainer to hand every shown notification to.
 */
export function createNotificationRetainer(
	limit: number = MAX_RETAINED_NOTIFICATIONS,
): NotificationRetainer {
	const retained = new Set<RetainableNotification>();

	/** Releases the least recently shown notifications until the cap is met. */
	const evictOldest = (): void => {
		for (const oldest of retained) {
			if (retained.size <= limit) {
				return;
			}
			retained.delete(oldest);
		}
	};

	return {
		/**
		 * Holds a shown notification, releasing it again the moment it is clicked,
		 * closed, or fails.
		 * @param notification - The notification that was just shown.
		 */
		retain: (notification) => {
			retained.add(notification);
			/** Lets go of a notification nobody can click again. */
			const release = (): void => {
				retained.delete(notification);
			};
			notification.on('click', release);
			notification.on('close', release);
			notification.on('failed', release);
			evictOldest();
		},
		/** How many notifications are currently held alive. */
		size: () => retained.size,
	};
}
