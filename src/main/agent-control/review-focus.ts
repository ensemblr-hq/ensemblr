/**
 * Where a review-comment op leaves the user. Filing or resolving comments pulls
 * the review panel to Checks — the roll-up that answers "what did the agent just
 * leave me, and what is still open" — rather than leaving them in the
 * file-by-file diff, where six findings mean scrolling six files to collect
 * them.
 *
 * Enforced here rather than steered in prose, the way `linear-ports.ts` enforces
 * the tracker rules, so the user lands in the right panel whether or not a model
 * decides to spend a `focusPanel` call on it.
 */

import type { FocusPort } from './ports.ts';

/**
 * How long one burst of comment ops holds its focus. Every op inside the window
 * extends it, so a review pass pulls focus once however many calls it makes and
 * however long it runs; a comment op after the workspace has been quiet this
 * long is a new pass and pulls focus again. Wide enough to span the model
 * round-trips between the calls of one pass, narrow enough that a pass an hour
 * later is not silently suppressed.
 */
const FOCUS_COALESCE_MS = 60_000;

/** Pulls the review panel to Checks after a comment op, once per burst. */
export interface ReviewFocus {
	focusChecks: (workspaceId: string) => void;
}

/**
 * Builds the coalescer over the focus port. It holds one timestamp per
 * workspace, which bounds the map at the workspaces this run has opened — the
 * same lifetime the board-status mirror keeps.
 * @param focus - The focus port each pull is broadcast through.
 * @param now - Clock injection so the coalescing window is testable.
 * @returns A coalescer holding one last-op stamp per workspace.
 */
export function createReviewFocus(
	focus: FocusPort,
	now: () => number = () => Date.now(),
): ReviewFocus {
	const lastOpAt = new Map<string, number>();
	return {
		focusChecks: (workspaceId) => {
			const at = now();
			const previous = lastOpAt.get(workspaceId);
			lastOpAt.set(workspaceId, at);
			if (previous !== undefined && at - previous < FOCUS_COALESCE_MS) {
				return;
			}
			focus.focusPanel({ panel: 'checks', workspaceId });
		},
	};
}
