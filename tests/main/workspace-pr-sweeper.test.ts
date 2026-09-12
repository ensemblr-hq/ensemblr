import { describe, expect, test, vi } from 'vitest';

import {
	createWorkspacePrStatusSweeper,
	type SweepableWorkspace,
} from '../../src/main/github/workspace-pr-sweeper';

const WORKSPACES: SweepableWorkspace[] = [
	{ hasPendingChecks: false, id: 'a', path: '/repo/a' },
	{ hasPendingChecks: false, id: 'b', path: '/repo/b' },
];

/** Fires the scheduler callback the sweeper registered on `start`. */
function tick(
	scheduleInterval: ReturnType<
		typeof vi.fn<(callback: () => void) => () => void>
	>,
): void {
	scheduleInterval.mock.calls[0]?.[0]();
}

/**
 * Lets the sweep a tick started run to completion. Asserting that a tick did
 * *not* refresh anything needs this first: `vi.waitFor` resolves the instant its
 * assertion holds, so an unflushed "still N calls" check passes before the sweep
 * it is meant to rule out has had a chance to make the N+1th.
 */
async function flushSweep(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createWorkspacePrStatusSweeper', () => {
	test('start refreshes every active workspace once, sequentially', async () => {
		const order: string[] = [];
		let activeRefreshes = 0;
		let maxConcurrentRefreshes = 0;
		const refreshSnapshot = vi.fn(async ({ workspaceId }) => {
			activeRefreshes += 1;
			maxConcurrentRefreshes = Math.max(
				maxConcurrentRefreshes,
				activeRefreshes,
			);
			order.push(`start:${workspaceId}`);
			// Yield so an unbounded Promise.all implementation would overlap calls.
			await Promise.resolve();
			order.push(`end:${workspaceId}`);
			activeRefreshes -= 1;
		});
		createWorkspacePrStatusSweeper({
			listActiveWorkspaces: () => WORKSPACES,
			refreshSnapshot,
			scheduleInterval: () => () => undefined,
		}).start();
		await vi.waitFor(() =>
			expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']),
		);
		expect(refreshSnapshot).toHaveBeenCalledTimes(2);
		expect(maxConcurrentRefreshes).toBe(1);
	});

	test('one workspace failing does not abort the rest of the sweep', async () => {
		const refreshSnapshot = vi.fn(async ({ workspaceId }) => {
			if (workspaceId === 'a') {
				throw new Error('gh exploded');
			}
		});
		createWorkspacePrStatusSweeper({
			listActiveWorkspaces: () => WORKSPACES,
			refreshSnapshot,
			scheduleInterval: () => () => undefined,
		}).start();
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(2));
	});

	test('the scheduled tick drives subsequent sweeps and dispose stops them', () => {
		let tick: (() => void) | null = null;
		const cancel = vi.fn();
		const refreshSnapshot = vi.fn(async () => undefined);
		const sweeper = createWorkspacePrStatusSweeper({
			listActiveWorkspaces: () => [WORKSPACES[0]],
			pendingIntervalMs: 1000,
			refreshSnapshot,
			scheduleInterval: (callback) => {
				tick = callback;
				return cancel;
			},
		});
		sweeper.start();
		expect(tick).not.toBeNull();
		sweeper.dispose();
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	test('start is idempotent — a second call does not double-schedule', () => {
		const scheduleInterval = vi.fn(() => () => undefined);
		const sweeper = createWorkspacePrStatusSweeper({
			listActiveWorkspaces: () => [],
			refreshSnapshot: async () => undefined,
			scheduleInterval,
		});
		sweeper.start();
		sweeper.start();
		expect(scheduleInterval).toHaveBeenCalledTimes(1);
	});

	test('ticks at the pending cadence so checks-in-flight rows refresh fast', () => {
		const scheduleInterval = vi.fn(() => () => undefined);
		createWorkspacePrStatusSweeper({
			listActiveWorkspaces: () => [],
			pendingIntervalMs: 20_000,
			refreshSnapshot: async () => undefined,
			scheduleInterval,
		}).start();
		expect(scheduleInterval).toHaveBeenCalledWith(expect.any(Function), 20_000);
	});

	test('a workspace with checks in flight is swept on the short cadence', async () => {
		const scheduleInterval = vi.fn((_callback: () => void) => () => undefined);
		let nowMs = 0;
		const refreshSnapshot = vi.fn(async () => undefined);
		createWorkspacePrStatusSweeper({
			idleIntervalMs: 120_000,
			listActiveWorkspaces: () => [
				{ hasPendingChecks: true, id: 'pending', path: '/repo/pending' },
			],
			now: () => nowMs,
			pendingIntervalMs: 20_000,
			refreshSnapshot,
			scheduleInterval,
		}).start();
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(1));

		nowMs = 20_000;
		tick(scheduleInterval);
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(2));
	});

	test('a workspace with no checks in flight waits out the idle cadence', async () => {
		const scheduleInterval = vi.fn((_callback: () => void) => () => undefined);
		let nowMs = 0;
		const refreshSnapshot = vi.fn(async () => undefined);
		createWorkspacePrStatusSweeper({
			idleIntervalMs: 120_000,
			listActiveWorkspaces: () => [
				{ hasPendingChecks: false, id: 'idle', path: '/repo/idle' },
			],
			now: () => nowMs,
			pendingIntervalMs: 20_000,
			refreshSnapshot,
			scheduleInterval,
		}).start();
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(1));

		nowMs = 20_000;
		tick(scheduleInterval);
		await flushSweep();
		expect(refreshSnapshot).toHaveBeenCalledTimes(1);

		nowMs = 120_000;
		tick(scheduleInterval);
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(2));
	});

	test('a workspace backs off to the idle cadence once its checks land', async () => {
		const scheduleInterval = vi.fn((_callback: () => void) => () => undefined);
		let nowMs = 0;
		let hasPendingChecks = true;
		const refreshSnapshot = vi.fn(async () => undefined);
		createWorkspacePrStatusSweeper({
			idleIntervalMs: 120_000,
			listActiveWorkspaces: () => [
				{ hasPendingChecks, id: 'flip', path: '/repo/flip' },
			],
			now: () => nowMs,
			pendingIntervalMs: 20_000,
			refreshSnapshot,
			scheduleInterval,
		}).start();
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(1));

		nowMs = 20_000;
		tick(scheduleInterval);
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(2));

		hasPendingChecks = false;
		nowMs = 40_000;
		tick(scheduleInterval);
		await flushSweep();
		expect(refreshSnapshot).toHaveBeenCalledTimes(2);

		nowMs = 140_000;
		tick(scheduleInterval);
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(3));
	});

	test('a listing failure skips the tick instead of rejecting', async () => {
		const rejections: unknown[] = [];
		const onRejection = (reason: unknown): void => {
			rejections.push(reason);
		};
		process.on('unhandledRejection', onRejection);
		const scheduleInterval = vi.fn((_callback: () => void) => () => undefined);
		let listed: SweepableWorkspace[] | null = null;
		const refreshSnapshot = vi.fn(async () => undefined);

		try {
			createWorkspacePrStatusSweeper({
				listActiveWorkspaces: () => {
					if (!listed) {
						throw new Error('database is closed');
					}
					return listed;
				},
				refreshSnapshot,
				scheduleInterval,
			}).start();
			await flushSweep();

			expect(rejections).toEqual([]);
			expect(refreshSnapshot).not.toHaveBeenCalled();

			listed = [WORKSPACES[0]];
			tick(scheduleInterval);
			await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(1));
		} finally {
			process.off('unhandledRejection', onRejection);
		}
	});

	test('a classified failure backs the workspace off past its ordinary cadence', async () => {
		const scheduleInterval = vi.fn((_callback: () => void) => () => undefined);
		let nowMs = 0;
		const refreshSnapshot = vi.fn(async () => ({
			error: { code: 'command-failed' as const },
		}));
		createWorkspacePrStatusSweeper({
			idleIntervalMs: 120_000,
			listActiveWorkspaces: () => [
				{ hasPendingChecks: true, id: 'flaky', path: '/repo/flaky' },
			],
			now: () => nowMs,
			pendingIntervalMs: 20_000,
			refreshSnapshot,
			scheduleInterval,
		}).start();
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(1));

		// The pending cadence alone would already make this due; a second
		// consecutive failure doubles the backoff past that cadence.
		nowMs = 20_000;
		tick(scheduleInterval);
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(2));

		nowMs = 40_000;
		tick(scheduleInterval);
		await flushSweep();
		expect(refreshSnapshot).toHaveBeenCalledTimes(2);
	});

	test('a code that will not recover on a timer is held back for a long, flat window', async () => {
		const scheduleInterval = vi.fn((_callback: () => void) => () => undefined);
		let nowMs = 0;
		const refreshSnapshot = vi.fn(async () => ({
			error: { code: 'gh-not-authenticated' as const },
		}));
		createWorkspacePrStatusSweeper({
			idleIntervalMs: 120_000,
			listActiveWorkspaces: () => [
				{ hasPendingChecks: false, id: 'unauthed', path: '/repo/unauthed' },
			],
			now: () => nowMs,
			pendingIntervalMs: 20_000,
			refreshSnapshot,
			scheduleInterval,
		}).start();
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(1));

		nowMs = 130_000;
		tick(scheduleInterval);
		await flushSweep();
		expect(refreshSnapshot).toHaveBeenCalledTimes(1);

		nowMs = 30 * 60_000 + 1;
		tick(scheduleInterval);
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(2));
	});

	test('a success clears a prior backoff so the ordinary cadence resumes', async () => {
		const scheduleInterval = vi.fn((_callback: () => void) => () => undefined);
		let nowMs = 0;
		let fail = true;
		const refreshSnapshot = vi.fn(async () =>
			fail ? { error: { code: 'command-failed' as const } } : undefined,
		);
		createWorkspacePrStatusSweeper({
			idleIntervalMs: 120_000,
			listActiveWorkspaces: () => [
				{ hasPendingChecks: true, id: 'recovers', path: '/repo/recovers' },
			],
			now: () => nowMs,
			pendingIntervalMs: 20_000,
			refreshSnapshot,
			scheduleInterval,
		}).start();
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(1));

		// The pending cadence alone would already make this due; the point is
		// that the failure's backoff no longer holds it back past that.
		fail = false;
		nowMs = 20_000;
		tick(scheduleInterval);
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(2));

		nowMs = 40_000;
		tick(scheduleInterval);
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(3));
	});

	test('a thrown refresh error backs off the same as a classified failure', async () => {
		const scheduleInterval = vi.fn((_callback: () => void) => () => undefined);
		let nowMs = 0;
		const refreshSnapshot = vi.fn(async () => {
			throw new Error('gh exploded');
		});
		createWorkspacePrStatusSweeper({
			idleIntervalMs: 120_000,
			listActiveWorkspaces: () => [
				{ hasPendingChecks: true, id: 'throws', path: '/repo/throws' },
			],
			now: () => nowMs,
			pendingIntervalMs: 20_000,
			refreshSnapshot,
			scheduleInterval,
		}).start();
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(1));

		nowMs = 20_000;
		tick(scheduleInterval);
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(2));

		nowMs = 40_000;
		tick(scheduleInterval);
		await flushSweep();
		expect(refreshSnapshot).toHaveBeenCalledTimes(2);
	});

	test('an unlisted workspace is swept again when it comes back', async () => {
		const scheduleInterval = vi.fn((_callback: () => void) => () => undefined);
		let nowMs = 0;
		let listed: SweepableWorkspace[] = [
			{ hasPendingChecks: false, id: 'idle', path: '/repo/idle' },
		];
		const refreshSnapshot = vi.fn(async () => undefined);
		createWorkspacePrStatusSweeper({
			idleIntervalMs: 120_000,
			listActiveWorkspaces: () => listed,
			now: () => nowMs,
			pendingIntervalMs: 20_000,
			refreshSnapshot,
			scheduleInterval,
		}).start();
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(1));

		listed = [];
		nowMs = 20_000;
		tick(scheduleInterval);
		await flushSweep();
		expect(refreshSnapshot).toHaveBeenCalledTimes(1);

		listed = [{ hasPendingChecks: false, id: 'idle', path: '/repo/idle' }];
		nowMs = 40_000;
		tick(scheduleInterval);
		await vi.waitFor(() => expect(refreshSnapshot).toHaveBeenCalledTimes(2));
	});
});
