/**
 * How `startReview` gets the prompt it opens the Review conversation with.
 *
 * The op's whole value is that an agent gets *the user's* review — the same
 * prompt the Review button composes, deferring to whatever review skill the
 * repository ships, carrying the user's own review instructions, on the model
 * they picked for reviews. Two of those inputs exist only in the renderer: the
 * personal per-repository instructions are still `localStorage`, and the review
 * model and thinking level are preference atoms. So main asks a window first.
 *
 * Unlike {@link createAskUserQuestionCoordinator}, which this mirrors, the wait
 * is bounded and the timeout is not a failure. No human is in this loop — a
 * window either answers within a frame or is not there — and an agent that
 * asked for a review must not have its turn parked on a renderer that never
 * replies. When nothing answers, main composes the brief itself from everything
 * it *can* see and says so in {@link ReviewLaunchBrief.source}.
 */

import { randomUUID } from 'node:crypto';

import type {
	ReviewBriefReply,
	ReviewBriefRequestedBroadcast,
} from '../../shared/ipc/contracts/review-launch.ts';
import type { ReviewLaunchBrief, ReviewLaunchPort } from './ports.ts';

/** Collaborators for {@link createReviewLaunchCoordinator}. */
export interface ReviewLaunchCoordinatorOptions {
	/** Pushes a compose request to every renderer window. */
	broadcastRequest: (payload: ReviewBriefRequestedBroadcast) => void;
	/** Whether any window is available to compose one. */
	hasRenderer: () => boolean;
	/** Composes the brief in main, for when no window answers. */
	composeFallback: (input: {
		workspaceId: string;
		workspaceCwd: string;
	}) => Promise<string>;
	/** Overrides request-id minting; defaults to a random UUID. */
	createRequestId?: () => string;
	/** Overrides the reply deadline; defaults to {@link REVIEW_BRIEF_TIMEOUT_MS}. */
	timeoutMs?: number;
	/** Overrides the timer, so a test does not wait out real milliseconds. */
	scheduleTimeout?: (run: () => void, delayMs: number) => () => void;
}

/** Public surface of the review-launch coordinator. */
export interface ReviewLaunchCoordinator {
	/** The port the agent-control service delegates `startReview` to. */
	port: ReviewLaunchPort;
	/** Settles a pending compose request with a renderer's answer. */
	settle: (reply: ReviewBriefReply) => void;
}

/**
 * How long main waits for a window to compose the brief.
 *
 * Generous for what it measures — a synchronous compose over state the renderer
 * already holds, plus one file write — and short against what it protects: an
 * agent's turn, which would otherwise sit on a window that is reloading, is
 * showing another workspace, or has gone. The cost of expiring early is a
 * slightly weaker review prompt, not a failed one.
 */
export const REVIEW_BRIEF_TIMEOUT_MS = 4_000;

/** A compose request waiting on a renderer. */
interface PendingBrief {
	resolve: (reply: ReviewBriefReply | null) => void;
	cancelTimeout: () => void;
}

/**
 * Default timer, extracted so a test can settle the deadline without waiting.
 * @param run - What to run when the deadline passes.
 * @param delayMs - How long to wait.
 * @returns The cancel, safe to call after the timer has already fired.
 */
function defaultScheduleTimeout(run: () => void, delayMs: number): () => void {
	const timer = setTimeout(run, delayMs);
	return () => {
		clearTimeout(timer);
	};
}

/**
 * Creates the review-launch coordinator.
 * @param options - Broadcast hook, renderer availability, and the main-side fallback.
 * @returns The control port plus the settle entry point main wires to IPC.
 */
export function createReviewLaunchCoordinator({
	broadcastRequest,
	hasRenderer,
	composeFallback,
	createRequestId = randomUUID,
	timeoutMs = REVIEW_BRIEF_TIMEOUT_MS,
	scheduleTimeout = defaultScheduleTimeout,
}: ReviewLaunchCoordinatorOptions): ReviewLaunchCoordinator {
	const pending = new Map<string, PendingBrief>();

	/**
	 * Removes a pending request and hands its answer to the waiting caller.
	 * @param requestId - Request to settle.
	 * @param reply - The renderer's answer, or null when the deadline passed.
	 */
	const withdraw = (
		requestId: string,
		reply: ReviewBriefReply | null,
	): void => {
		const entry = pending.get(requestId);
		if (!entry) {
			return;
		}
		pending.delete(requestId);
		entry.cancelTimeout();
		entry.resolve(reply);
	};

	/**
	 * Puts the compose request to the renderers and waits out the deadline.
	 * @param workspaceId - Workspace whose review prompt to compose.
	 * @returns The renderer's answer, or null when none arrived in time.
	 */
	const askRenderer = async (
		workspaceId: string,
	): Promise<ReviewBriefReply | null> => {
		if (!hasRenderer()) {
			return null;
		}
		const requestId = createRequestId();
		return await new Promise<ReviewBriefReply | null>((resolve) => {
			const cancelTimeout = scheduleTimeout(() => {
				withdraw(requestId, null);
			}, timeoutMs);
			pending.set(requestId, { cancelTimeout, resolve });
			broadcastRequest({ requestId, workspaceId });
		});
	};

	return {
		port: {
			/** Asks a window for the user's own review prompt, composing one if none answers. */
			composeBrief: async ({
				workspaceId,
				workspaceCwd,
			}): Promise<ReviewLaunchBrief> => {
				const reply = await askRenderer(workspaceId);
				if (reply?.prompt) {
					return {
						model: reply.model ?? null,
						prompt: reply.prompt,
						source: 'renderer',
						thinkingLevel: reply.thinkingLevel ?? null,
					};
				}
				return {
					model: null,
					prompt: await composeFallback({ workspaceCwd, workspaceId }),
					source: 'fallback',
					thinkingLevel: null,
				};
			},
		},
		settle: (reply) => {
			withdraw(reply.requestId, reply);
		},
	};
}
