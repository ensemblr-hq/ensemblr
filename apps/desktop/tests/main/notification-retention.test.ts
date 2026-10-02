import { expect, test } from 'vitest';

import {
	createNotificationRetainer,
	type RetainableNotification,
} from '../../src/main/agent-runtime/notification-retention.ts';

/**
 * A stand-in for Electron's `Notification` that records its listeners, so a case
 * can fire the events macOS would.
 */
function fakeNotification(): RetainableNotification & {
	emit: (event: string) => void;
} {
	const listeners = new Map<string, () => void>();
	return {
		emit: (event) => listeners.get(event)?.(),
		on: (event, listener) => listeners.set(event, listener),
	};
}

test('holds a shown notification so its click handler survives', () => {
	const retainer = createNotificationRetainer();
	retainer.retain(fakeNotification());

	expect(retainer.size()).toBe(1);
});

test.each(['click', 'close', 'failed'])(
	'releases a notification once it is %s',
	(event) => {
		const retainer = createNotificationRetainer();
		const notification = fakeNotification();
		retainer.retain(notification);
		notification.emit(event);

		expect(retainer.size()).toBe(0);
	},
);

test('drops the oldest rather than growing without bound', () => {
	const retainer = createNotificationRetainer(2);
	const first = fakeNotification();
	retainer.retain(first);
	retainer.retain(fakeNotification());
	retainer.retain(fakeNotification());

	expect(retainer.size()).toBe(2);
	first.emit('close');
	expect(retainer.size()).toBe(2);
});
