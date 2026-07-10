import { describe, expect, test, vi } from 'vitest';

import {
	planClose,
	runConfirmedClose,
} from '../../src/renderer/state/workspace/close-running-chat-guard';

describe('planClose', () => {
	test('closes immediately when the target is idle', () => {
		const onClose = vi.fn(() => {});
		const onStop = vi.fn(() => {});
		const plan = planClose({ isRunning: false, onClose, onStop });
		expect(plan).toEqual({ kind: 'close-now' });
		// Pure: deciding to close-now must not run the callbacks itself.
		expect(onClose).not.toHaveBeenCalled();
		expect(onStop).not.toHaveBeenCalled();
	});

	test('defers a running target, carrying both callbacks', () => {
		const onClose = vi.fn(() => {});
		const onStop = vi.fn(() => {});
		const plan = planClose({ isRunning: true, onClose, onStop });
		expect(plan.kind).toBe('defer');
		if (plan.kind === 'defer') {
			expect(plan.pending.onClose).toBe(onClose);
			expect(plan.pending.onStop).toBe(onStop);
		}
		expect(onClose).not.toHaveBeenCalled();
		expect(onStop).not.toHaveBeenCalled();
	});
});

describe('runConfirmedClose', () => {
	test('starts the agent stop before closing the tab', async () => {
		const order: string[] = [];
		await runConfirmedClose({
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
			onClose,
			onStop: () => Promise.reject(new Error('stop failed')),
		});
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	test('still closes the tab when the stop throws synchronously', async () => {
		const onClose = vi.fn(() => {});
		await runConfirmedClose({
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
