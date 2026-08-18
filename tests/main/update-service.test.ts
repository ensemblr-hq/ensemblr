import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ReleaseFeed } from '../../src/main/updates/release-feed';
import type { UpdateServiceOptions } from '../../src/main/updates/update-service';
import { createUpdateService } from '../../src/main/updates/update-service';
import type { UpdateStatusSnapshot } from '../../src/shared/ipc/contracts/update';

/** A feed that always offers one newer build, and records how often it was asked. */
function offeringFeed(
	version = '0.2.0',
): ReleaseFeed & { calls: () => number } {
	let calls = 0;
	return {
		calls: () => calls,
		resolve: async () => {
			calls += 1;
			return {
				candidate: {
					feedUrl: 'https://example.invalid/update-darwin-arm64.json',
					notes: null,
					version,
				},
				status: 'ok' as const,
			};
		},
	};
}

/**
 * Builds a service with every port faked, defaulting to a packaged release
 * build the user has left updates switched on for.
 */
function harness(overrides: Partial<UpdateServiceOptions> = {}) {
	const armed: string[] = [];
	const broadcasts: UpdateStatusSnapshot[] = [];
	const installs: number[] = [];
	let enabled = true;
	let handlers: Parameters<UpdateServiceOptions['onUpdaterEvent']>[0] | null =
		null;

	const service = createUpdateService({
		armUpdater: (feedUrl) => armed.push(feedUrl),
		broadcast: (snapshot) => broadcasts.push(snapshot),
		channel: 'release',
		getCurrentVersion: () => '0.1.0',
		isEnabled: () => enabled,
		onUpdaterEvent: (next) => {
			handlers = next;
		},
		preconditionFailure: null,
		releaseFeed: offeringFeed(),
		requestInstall: () => installs.push(1),
		...overrides,
	});

	return {
		armed,
		broadcasts,
		fireDownloaded: () => handlers?.onDownloaded(),
		fireError: () => handlers?.onError(new Error('Squirrel gave up')),
		installs,
		service,
		setEnabled: (value: boolean) => {
			enabled = value;
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('createUpdateService — the automatic-updates setting', () => {
	test('starts disabled when the user has updates switched off', () => {
		const h = harness({ isEnabled: () => false });

		expect(h.service.snapshot().state).toBe('disabled');
	});

	test('a disabled build never reaches the network, even when asked directly', async () => {
		const feed = offeringFeed();
		const h = harness({ isEnabled: () => false, releaseFeed: feed });

		const result = await h.service.checkNow();

		expect(result.state).toBe('disabled');
		expect(feed.calls()).toBe(0);
		expect(h.armed).toEqual([]);
	});

	test('a disabled build schedules nothing', async () => {
		const feed = offeringFeed();
		const h = harness({ isEnabled: () => false, releaseFeed: feed });

		h.service.start();
		await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);

		expect(feed.calls()).toBe(0);
	});

	test('an enabled build checks on its schedule', async () => {
		const feed = offeringFeed();
		const h = harness({ releaseFeed: feed });

		h.service.start();
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

		expect(feed.calls()).toBe(1);
		expect(h.armed).toHaveLength(1);
		expect(h.service.snapshot().state).toBe('downloading');
	});

	test('switching updates off stops the schedule', async () => {
		const feed = offeringFeed();
		const h = harness({ releaseFeed: feed });
		h.service.start();

		h.setEnabled(false);
		h.service.settingsChanged();
		await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);

		expect(feed.calls()).toBe(0);
		expect(h.service.snapshot().state).toBe('disabled');
	});

	test('switching updates back on checks straight away', async () => {
		const feed = offeringFeed();
		const h = harness({ releaseFeed: feed });
		h.setEnabled(false);
		h.service.settingsChanged();
		h.service.start();

		h.setEnabled(true);
		h.service.settingsChanged();
		await vi.advanceTimersByTimeAsync(0);

		expect(feed.calls()).toBe(1);
		expect(h.armed).toHaveLength(1);
	});

	test('switching off drops a staged update rather than leaving it offerable', async () => {
		const h = harness();
		h.service.start();
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
		h.fireDownloaded();
		expect(h.service.snapshot().state).toBe('ready');

		h.setEnabled(false);
		h.service.settingsChanged();

		expect(h.service.snapshot().state).toBe('disabled');
		expect(h.service.snapshot().availableVersion).toBeNull();
	});

	test('a download that lands after the switch went off is dropped', async () => {
		const h = harness();
		h.service.start();
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
		expect(h.service.snapshot().state).toBe('downloading');

		h.setEnabled(false);
		h.service.settingsChanged();
		h.fireDownloaded();

		expect(h.service.snapshot().state).toBe('disabled');
	});

	test('a Squirrel failure after the switch went off is dropped too', async () => {
		const h = harness();
		h.service.start();
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

		h.setEnabled(false);
		h.service.settingsChanged();
		h.fireError();

		expect(h.service.snapshot().state).toBe('disabled');
		expect(h.service.snapshot().failure).toBeNull();
	});

	test('a staged update cannot be installed once updates are off', async () => {
		const h = harness();
		h.service.start();
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
		h.fireDownloaded();

		h.setEnabled(false);
		h.service.install();

		expect(h.installs).toEqual([]);
	});

	test('a staged update installs while updates are on', async () => {
		const h = harness();
		h.service.start();
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
		h.fireDownloaded();

		h.service.install();

		expect(h.installs).toEqual([1]);
	});

	test('the setting cannot revive a build that can never update', () => {
		const h = harness({
			isEnabled: () => true,
			preconditionFailure: {
				code: 'update-not-in-applications',
				message: 'Run it from /Applications.',
			},
		});

		h.service.settingsChanged();

		expect(h.service.snapshot().state).toBe('unsupported');
	});
});
