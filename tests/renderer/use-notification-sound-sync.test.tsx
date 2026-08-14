// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const { playNotificationSound } = vi.hoisted(() => ({
	playNotificationSound: vi.fn(),
}));

vi.mock('@/renderer/lib/notification-sound', () => ({ playNotificationSound }));

import { useNotificationSoundSync } from '../../src/renderer/hooks/use-notification-sound-sync';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

const unsubscribe = vi.fn();
const onNotificationSoundRequested = vi.fn();

beforeEach(() => {
	playNotificationSound.mockReset();
	unsubscribe.mockReset();
	onNotificationSoundRequested.mockReset();
	onNotificationSoundRequested.mockReturnValue(unsubscribe);
	installEnsemblrApi({ onNotificationSoundRequested });
});

test('plays the chime when main asks for it', () => {
	renderHook(() => useNotificationSoundSync());
	const requested = onNotificationSoundRequested.mock.calls[0][0];

	requested();

	expect(playNotificationSound).toHaveBeenCalledTimes(1);
});

test('drops the subscription on unmount', () => {
	const { unmount } = renderHook(() => useNotificationSoundSync());
	expect(onNotificationSoundRequested).toHaveBeenCalledTimes(1);

	unmount();

	expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('subscribes without the preload bridge', () => {
	clearEnsemblrApi();
	expect(() =>
		renderHook(() => useNotificationSoundSync()).unmount(),
	).not.toThrow();
	expect(playNotificationSound).not.toHaveBeenCalled();
});
