import { describe, expect, test, vi } from 'vitest';
import {
	createQuitCoordinator,
	type QuitCoordinatorOptions,
	type QuitExit,
} from '../../src/main/app/quit-coordinator';

/** Lets the coordinator's internal confirmation promise settle. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeCoordinator(overrides: Partial<QuitCoordinatorOptions> = {}) {
	const counts = { quits: 0, shutdowns: 0 };
	const exits: QuitExit[] = [];
	const coordinator = createQuitCoordinator({
		beginAgentShutdown: (exit) => {
			counts.shutdowns += 1;
			exits.push(exit);
		},
		confirmQuit: () => Promise.resolve(true),
		quit: () => {
			counts.quits += 1;
		},
		...overrides,
	});
	return { coordinator, counts, exits };
}

describe('createQuitCoordinator — before-quit', () => {
	test('defers the first quit and asks instead of tearing down', async () => {
		const h = makeCoordinator({ confirmQuit: () => Promise.resolve(false) });
		expect(h.coordinator.handleBeforeQuit()).toBe(true);
		await flush();
		expect(h.counts.shutdowns).toBe(0);
		expect(h.counts.quits).toBe(0);
	});

	test('re-issues the quit once the user accepts', async () => {
		const h = makeCoordinator();
		h.coordinator.handleBeforeQuit();
		await flush();
		expect(h.counts.quits).toBe(1);
	});

	test('the re-issued quit starts the agent teardown', async () => {
		const h = makeCoordinator();
		h.coordinator.handleBeforeQuit();
		await flush();
		expect(h.coordinator.handleBeforeQuit()).toBe(true);
		expect(h.counts.shutdowns).toBe(1);
	});

	test('lets the quit through once the teardown has re-issued it', async () => {
		const h = makeCoordinator();
		h.coordinator.handleBeforeQuit();
		await flush();
		h.coordinator.handleBeforeQuit();
		expect(h.coordinator.handleBeforeQuit()).toBe(false);
		expect(h.counts.shutdowns).toBe(1);
	});

	test('a repeat gesture mid-confirmation cannot stack a second dialog', async () => {
		const confirmQuit = vi.fn(() => Promise.resolve(true));
		const h = makeCoordinator({ confirmQuit });
		h.coordinator.handleBeforeQuit();
		expect(h.coordinator.handleBeforeQuit()).toBe(true);
		expect(h.coordinator.handleBeforeQuit()).toBe(true);
		await flush();
		expect(confirmQuit).toHaveBeenCalledTimes(1);
	});

	test('cancelling latches nothing, so the next gesture asks again', async () => {
		const confirmQuit = vi
			.fn<() => Promise<boolean>>()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const h = makeCoordinator({ confirmQuit });
		h.coordinator.handleBeforeQuit();
		await flush();
		expect(h.counts.quits).toBe(0);
		h.coordinator.handleBeforeQuit();
		await flush();
		expect(confirmQuit).toHaveBeenCalledTimes(2);
		expect(h.counts.quits).toBe(1);
	});
});

describe('createQuitCoordinator — window close', () => {
	test('defers the close and asks, so the dialog still has a window', async () => {
		const replayClose = vi.fn();
		const h = makeCoordinator({ confirmQuit: () => Promise.resolve(false) });
		expect(h.coordinator.handleWindowClose(replayClose)).toBe(true);
		await flush();
		expect(replayClose).not.toHaveBeenCalled();
	});

	test('replays the close once the user accepts, and lets it through', async () => {
		const replayClose = vi.fn();
		const h = makeCoordinator();
		h.coordinator.handleWindowClose(replayClose);
		await flush();
		expect(replayClose).toHaveBeenCalledTimes(1);
		expect(h.coordinator.handleWindowClose(replayClose)).toBe(false);
	});

	test('an accepted close satisfies the quit it cascades into', async () => {
		const confirmQuit = vi.fn(() => Promise.resolve(true));
		const h = makeCoordinator({ confirmQuit });
		h.coordinator.handleWindowClose(() => undefined);
		await flush();
		expect(h.coordinator.handleBeforeQuit()).toBe(true);
		expect(h.counts.shutdowns).toBe(1);
		expect(confirmQuit).toHaveBeenCalledTimes(1);
	});

	test('a close mid-confirmation is refused, so no window is stranded', async () => {
		const replayClose = vi.fn();
		const h = makeCoordinator({ confirmQuit: () => Promise.resolve(false) });
		h.coordinator.handleBeforeQuit();
		expect(h.coordinator.handleWindowClose(replayClose)).toBe(true);
		await flush();
		expect(replayClose).not.toHaveBeenCalled();
	});

	test('lets a close through once the teardown is under way', async () => {
		const h = makeCoordinator();
		h.coordinator.handleBeforeQuit();
		await flush();
		h.coordinator.handleBeforeQuit();
		expect(h.coordinator.handleWindowClose(() => undefined)).toBe(false);
	});
});

describe('createQuitCoordinator — a confirmation that throws', () => {
	test('fails open rather than stranding the app unquittable', async () => {
		const h = makeCoordinator({
			confirmQuit: () => Promise.reject(new Error('window destroyed')),
		});
		h.coordinator.handleBeforeQuit();
		await flush();
		expect(h.counts.quits).toBe(1);
		expect(h.coordinator.handleBeforeQuit()).toBe(true);
		expect(h.counts.shutdowns).toBe(1);
	});

	test('a rejected close confirmation still replays the close', async () => {
		const replayClose = vi.fn();
		const h = makeCoordinator({
			confirmQuit: () => Promise.reject(new Error('window destroyed')),
		});
		h.coordinator.handleWindowClose(replayClose);
		await flush();
		expect(replayClose).toHaveBeenCalledTimes(1);
		expect(h.coordinator.handleWindowClose(replayClose)).toBe(false);
	});
});

describe('createQuitCoordinator — restart into an update', () => {
	test('issues a quit gesture, which is what puts it to the user', async () => {
		const confirmQuit = vi.fn(() => Promise.resolve(true));
		const h = makeCoordinator({ confirmQuit });
		h.coordinator.requestInstallUpdate();
		expect(h.counts.quits).toBe(1);
		expect(confirmQuit).not.toHaveBeenCalled();
		h.coordinator.handleBeforeQuit();
		await flush();
		expect(confirmQuit).toHaveBeenCalledTimes(1);
	});

	test('the install exit survives the replay and reaches the teardown', async () => {
		const h = makeCoordinator();
		h.coordinator.requestInstallUpdate();
		h.coordinator.handleBeforeQuit();
		await flush();
		h.coordinator.handleBeforeQuit();
		expect(h.exits).toEqual(['install-update']);
	});

	test('an ordinary quit still tears down as a plain quit', async () => {
		const h = makeCoordinator();
		h.coordinator.handleBeforeQuit();
		await flush();
		h.coordinator.handleBeforeQuit();
		expect(h.exits).toEqual(['quit']);
	});

	test('a refused restart leaves the next gesture an ordinary quit', async () => {
		const confirmQuit = vi
			.fn<() => Promise<boolean>>()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const h = makeCoordinator({ confirmQuit });
		h.coordinator.requestInstallUpdate();
		h.coordinator.handleBeforeQuit();
		await flush();
		expect(h.exits).toEqual([]);
		h.coordinator.handleBeforeQuit();
		await flush();
		h.coordinator.handleBeforeQuit();
		expect(h.exits).toEqual(['quit']);
	});

	test('a restart request cannot repurpose a quit already being confirmed', async () => {
		const confirmQuit = vi.fn(() => Promise.resolve(true));
		const h = makeCoordinator({ confirmQuit });
		h.coordinator.handleBeforeQuit();
		h.coordinator.requestInstallUpdate();
		await flush();
		h.coordinator.handleBeforeQuit();
		expect(confirmQuit).toHaveBeenCalledTimes(1);
		expect(h.exits).toEqual(['quit']);
	});
});
