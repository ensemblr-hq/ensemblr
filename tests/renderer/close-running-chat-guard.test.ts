import { describe, expect, test, vi } from 'vitest';

import {
	planClose,
	runConfirmedClose,
} from '../../src/renderer/state/workspace/close-running-chat-guard';

describe('planClose', () => {
	test('closes immediately when the target is idle', () => {
		const onClose = vi.fn(() => {});
		const onStop = vi.fn(() => {});
		const plan = planClose({
			backgroundTaskCount: 0,
			isRunning: false,
			onClose,
			onStop,
		});
		expect(plan).toEqual({ kind: 'close-now' });
		// Pure: deciding to close-now must not run the callbacks itself.
		expect(onClose).not.toHaveBeenCalled();
		expect(onStop).not.toHaveBeenCalled();
	});

	test('defers a running target, carrying both callbacks', () => {
		const onClose = vi.fn(() => {});
		const onStop = vi.fn(() => {});
		const plan = planClose({
			backgroundTaskCount: 0,
			isRunning: true,
			onClose,
			onStop,
		});
		expect(plan.kind).toBe('defer');
		if (plan.kind === 'defer') {
			expect(plan.pending.onClose).toBe(onClose);
			expect(plan.pending.onStop).toBe(onStop);
		}
		expect(onClose).not.toHaveBeenCalled();
		expect(onStop).not.toHaveBeenCalled();
	});

	test('defers an idle target that still holds background tasks', () => {
		const plan = planClose({
			backgroundTaskCount: 2,
			isRunning: false,
			onClose: vi.fn(() => {}),
			onStop: vi.fn(() => {}),
		});
		expect(plan.kind).toBe('defer');
		if (plan.kind === 'defer') {
			expect(plan.pending.backgroundTaskCount).toBe(2);
		}
	});

	test('a running target that also holds background tasks carries both', () => {
		// The two are independent and the dialog names both: confirming cancels the
		// turn *and* takes the background work with it, and a user who is only told
		// about the turn loses the shells without being asked.
		const plan = planClose({
			backgroundTaskCount: 3,
			isRunning: true,
			onClose: vi.fn(() => {}),
			onStop: vi.fn(() => {}),
		});
		expect(plan.kind).toBe('defer');
		if (plan.kind === 'defer') {
			expect(plan.pending.backgroundTaskCount).toBe(3);
			expect(plan.pending.isRunning).toBe(true);
		}
	});

	test('an idle target deferred for background tasks reports no running turn', () => {
		const plan = planClose({
			backgroundTaskCount: 2,
			isRunning: false,
			onClose: vi.fn(() => {}),
			onStop: vi.fn(() => {}),
		});
		expect(plan.kind).toBe('defer');
		if (plan.kind === 'defer') {
			expect(plan.pending.isRunning).toBe(false);
		}
	});
});

describe('runConfirmedClose', () => {
	test('starts the agent stop before closing the tab', async () => {
		const order: string[] = [];
		await runConfirmedClose({
			backgroundTaskCount: 0,
			isRunning: true,
			onClose: () => {
				order.push('close');
			},
			onStop: async () => {
				order.push('stop');
			},
		});
		expect(order).toEqual(['stop', 'close']);
	});

	test('closes immediately without waiting for an async stop', async () => {
		const order: string[] = [];
		let resolveStop: () => void = () => undefined;
		const stop = new Promise<void>((resolve) => {
			resolveStop = () => {
				order.push('stop');
				resolve();
			};
		});

		await runConfirmedClose({
			backgroundTaskCount: 0,
			isRunning: true,
			onClose: () => {
				order.push('close');
			},
			onStop: () => stop,
		});
		expect(order).toEqual(['close']);

		resolveStop();
		await stop;
		expect(order).toEqual(['close', 'stop']);
	});

	test('still closes the tab when the stop rejects', async () => {
		const onClose = vi.fn(() => {});
		await runConfirmedClose({
			backgroundTaskCount: 0,
			isRunning: true,
			onClose,
			onStop: () => Promise.reject(new Error('stop failed')),
		});
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	test('still closes the tab when the stop throws synchronously', async () => {
		const onClose = vi.fn(() => {});
		await runConfirmedClose({
			backgroundTaskCount: 0,
			isRunning: true,
			onClose,
			onStop: () => {
				throw new Error('boom');
			},
		});
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	test('supports a synchronous (void) stop', async () => {
		const order: string[] = [];
		await runConfirmedClose({
			backgroundTaskCount: 0,
			isRunning: true,
			onClose: () => {
				order.push('close');
			},
			onStop: () => {
				order.push('stop');
			},
		});
		expect(order).toEqual(['stop', 'close']);
	});
});
