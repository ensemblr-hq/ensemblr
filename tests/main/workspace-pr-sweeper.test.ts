import { describe, expect, test, vi } from 'vitest';

import {
	createWorkspacePrStatusSweeper,
	type SweepableWorkspace,
} from '../../src/main/github/workspace-pr-sweeper';

const WORKSPACES: SweepableWorkspace[] = [
	{ id: 'a', path: '/repo/a' },
	{ id: 'b', path: '/repo/b' },
];

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
			intervalMs: 1000,
			listActiveWorkspaces: () => [WORKSPACES[0]],
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
});
