import { describe, expect, it, vi } from 'vitest';

import type { FocusPort } from '../../src/main/agent-control/ports.ts';
import { createReviewFocus } from '../../src/main/agent-control/review-focus.ts';

const makeFocusPort = (): FocusPort => ({
	focusTab: vi.fn(),
	focusDockTab: vi.fn(),
	focusPanel: vi.fn(),
	focusWorkspace: vi.fn(),
});

/** Drives the coalescer against a clock the test moves by hand. */
const makeClock = (start = 1_000) => {
	let at = start;
	return {
		now: () => at,
		advance: (ms: number) => {
			at += ms;
		},
	};
};

describe('review focus', () => {
	it('pulls the review panel to Checks on the first comment op', () => {
		const focus = makeFocusPort();
		createReviewFocus(focus, makeClock().now).focusChecks('ws');
		expect(focus.focusPanel).toHaveBeenCalledWith({
			panel: 'checks',
			workspaceId: 'ws',
		});
	});

	// A pass that files comments and then closes the ones it fixed is several
	// calls; yanking the user once per call is the focus-stealing the coalescing
	// window exists to prevent.
	it('pulls focus once for a burst of comment ops', () => {
		const focus = makeFocusPort();
		const clock = makeClock();
		const reviewFocus = createReviewFocus(focus, clock.now);
		reviewFocus.focusChecks('ws');
		clock.advance(5_000);
		reviewFocus.focusChecks('ws');
		clock.advance(20_000);
		reviewFocus.focusChecks('ws');
		expect(focus.focusPanel).toHaveBeenCalledTimes(1);
	});

	// Every op inside the window extends it, so the coalescing holds for a pass
	// of any length rather than expiring under one that runs long.
	it('holds one focus across a burst longer than the window', () => {
		const focus = makeFocusPort();
		const clock = makeClock();
		const reviewFocus = createReviewFocus(focus, clock.now);
		for (let call = 0; call < 10; call += 1) {
			reviewFocus.focusChecks('ws');
			clock.advance(30_000);
		}
		expect(focus.focusPanel).toHaveBeenCalledTimes(1);
	});

	it('pulls focus again for a pass after the workspace has gone quiet', () => {
		const focus = makeFocusPort();
		const clock = makeClock();
		const reviewFocus = createReviewFocus(focus, clock.now);
		reviewFocus.focusChecks('ws');
		clock.advance(60_000);
		reviewFocus.focusChecks('ws');
		expect(focus.focusPanel).toHaveBeenCalledTimes(2);
	});

	// The window is per workspace: one workspace's burst must not swallow
	// another's first pull, since the two panels are different windows.
	it('coalesces each workspace on its own', () => {
		const focus = makeFocusPort();
		const clock = makeClock();
		const reviewFocus = createReviewFocus(focus, clock.now);
		reviewFocus.focusChecks('ws-a');
		reviewFocus.focusChecks('ws-b');
		reviewFocus.focusChecks('ws-a');
		expect(focus.focusPanel).toHaveBeenCalledTimes(2);
		expect(focus.focusPanel).toHaveBeenNthCalledWith(1, {
			panel: 'checks',
			workspaceId: 'ws-a',
		});
		expect(focus.focusPanel).toHaveBeenNthCalledWith(2, {
			panel: 'checks',
			workspaceId: 'ws-b',
		});
	});
});
