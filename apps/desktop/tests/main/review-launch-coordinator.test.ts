import { describe, expect, it, vi } from 'vitest';

import { createReviewLaunchCoordinator } from '../../src/main/agent-control/review-launch.ts';
import type { ReviewBriefRequestedBroadcast } from '../../src/shared/ipc/contracts/review-launch.ts';

/** A coordinator whose deadline a test fires by hand rather than waiting out. */
function coordinator(
	options: { hasRenderer?: boolean; fallback?: string } = {},
) {
	const broadcasts: ReviewBriefRequestedBroadcast[] = [];
	const deadlines: (() => void)[] = [];
	const composeFallback = vi.fn(async () => options.fallback ?? 'FALLBACK');
	const created = createReviewLaunchCoordinator({
		broadcastRequest: (payload) => broadcasts.push(payload),
		composeFallback,
		createRequestId: () => 'request-1',
		hasRenderer: () => options.hasRenderer ?? true,
		scheduleTimeout: (run) => {
			deadlines.push(run);
			return () => {
				const index = deadlines.indexOf(run);
				if (index > -1) {
					deadlines.splice(index, 1);
				}
			};
		},
	});
	return { broadcasts, composeFallback, deadlines, ...created };
}

const WORKSPACE = { workspaceCwd: '/tmp/ws', workspaceId: 'ws-1' };

describe('review launch coordinator', () => {
	it('asks the renderers and returns what one composes', async () => {
		const harness = coordinator();

		const pending = harness.port.composeBrief(WORKSPACE);
		harness.settle({
			model: 'claude-opus-5',
			prompt: 'THE REVIEW',
			requestId: 'request-1',
			thinkingLevel: 'high',
		});

		await expect(pending).resolves.toEqual({
			model: 'claude-opus-5',
			prompt: 'THE REVIEW',
			source: 'renderer',
			thinkingLevel: 'high',
		});
		expect(harness.broadcasts).toEqual([
			{ requestId: 'request-1', workspaceId: 'ws-1' },
		]);
		expect(harness.composeFallback).not.toHaveBeenCalled();
	});

	// An agent's turn must not sit on a window that is reloading or has gone, and
	// a slightly weaker prompt is a better outcome than a parked review.
	it('falls back when no window answers before the deadline', async () => {
		const harness = coordinator();

		const pending = harness.port.composeBrief(WORKSPACE);
		harness.deadlines[0]?.();

		await expect(pending).resolves.toEqual({
			model: null,
			prompt: 'FALLBACK',
			source: 'fallback',
			thinkingLevel: null,
		});
	});

	// An empty prompt is a window saying "not mine to answer" — it holds no live
	// model for that workspace — rather than a review with nothing in it.
	it('falls back when the window declines with an empty prompt', async () => {
		const harness = coordinator();

		const pending = harness.port.composeBrief(WORKSPACE);
		harness.settle({ prompt: '', requestId: 'request-1' });

		await expect(pending).resolves.toMatchObject({
			prompt: 'FALLBACK',
			source: 'fallback',
		});
	});

	it('composes its own brief without broadcasting when no window exists', async () => {
		const harness = coordinator({ hasRenderer: false });

		await expect(harness.port.composeBrief(WORKSPACE)).resolves.toMatchObject({
			source: 'fallback',
		});
		expect(harness.broadcasts).toEqual([]);
	});

	// A second window answering the same request, or a reply that arrives after
	// the deadline, must not throw across the IPC boundary.
	it('ignores a late or duplicate reply', async () => {
		const harness = coordinator();

		const pending = harness.port.composeBrief(WORKSPACE);
		harness.settle({ prompt: 'FIRST', requestId: 'request-1' });
		await pending;

		expect(() =>
			harness.settle({ prompt: 'SECOND', requestId: 'request-1' }),
		).not.toThrow();
		expect(() =>
			harness.settle({ prompt: 'OTHER', requestId: 'unknown' }),
		).not.toThrow();
	});

	it('drops the deadline once a window has answered', async () => {
		const harness = coordinator();

		const pending = harness.port.composeBrief(WORKSPACE);
		harness.settle({ prompt: 'THE REVIEW', requestId: 'request-1' });
		await pending;

		expect(harness.deadlines).toEqual([]);
	});
});
