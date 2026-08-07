/**
 * Blocking question channel between an agent and the human. `askUserQuestion`
 * holds the agent's control call open while the renderer shows the questionnaire
 * in the chat tab that asked it, then settles when the user answers or dismisses
 * it, the asking turn ends, or the session goes away. There is deliberately no
 * timeout: a question the user has not got to yet is still a question worth
 * answering, and the agent has nothing to do until they do.
 */
import { randomUUID } from 'node:crypto';

import type {
	AskUserQuestionBroadcast,
	AskUserQuestionClosedBroadcast,
	AskUserQuestionItem,
	AskUserQuestionReply,
	AskUserQuestionResult,
} from '../../shared/agent-control.ts';
import { buildAskUserQuestionResult } from '../../shared/agent-control.ts';
import type { AskPort } from './ports.ts';

/** Collaborators for {@link createAskUserQuestionCoordinator}. */
interface AskUserQuestionCoordinatorOptions {
	/** Pushes a questionnaire to every renderer window. */
	broadcastAsk: (payload: AskUserQuestionBroadcast) => void;
	/** Tells renderers a pending questionnaire is no longer answerable. */
	broadcastClosed: (payload: AskUserQuestionClosedBroadcast) => void;
	/** Whether any window is available to host the dialog. */
	hasRenderer: () => boolean;
	/** Overrides request-id minting; defaults to a random UUID. */
	createRequestId?: () => string;
}

/** Public surface of the ask coordinator. */
export interface AskUserQuestionCoordinator {
	/** The port the agent-control service delegates `askUserQuestion` to. */
	port: AskPort;
	/**
	 * Settles a pending questionnaire with the user's answer. Unknown ids are
	 * ignored, so a late or duplicate reply cannot throw across the IPC boundary.
	 */
	settle: (reply: AskUserQuestionReply) => void;
	/**
	 * Every questionnaire still waiting on the user, as the broadcasts that first
	 * announced them. A renderer holds its pending questions in memory only, so a
	 * window that reloads or opens late replays these to get back in step —
	 * without them the card is gone while the agent stays blocked.
	 */
	openAsks: () => AskUserQuestionBroadcast[];
}

/** A questionnaire waiting on the user, keyed by its request id. */
interface PendingAsk {
	sessionId: string;
	resolve: (result: AskUserQuestionResult) => void;
	/** Detaches the caller's abort listener; a no-op when it had no signal. */
	dispose: () => void;
	/** The announcement to replay to a renderer that missed or lost it. */
	broadcast: AskUserQuestionBroadcast;
}

/** Told to the agent when no window exists to render the questionnaire. */
const NO_RENDERER_SUMMARY =
	'No Ensemblr window was available to show the question, so the user never saw it. Do not treat this as a decline — ask in your reply instead.';

/** Told to the agent when it already has a questionnaire on screen. */
const CONCURRENT_ASK_SUMMARY =
	'This conversation already has a question waiting on the user, so this one was not shown. Do not treat this as a decline — wait for the first answer, and ask related questions in a single call.';

/** Told to the agent when its turn ended before the user answered. */
const ABANDONED_SUMMARY =
	'The turn that asked this question ended before the user answered, so the question was taken off screen. Do not treat this as a decline — ask again in your reply.';

/**
 * Creates the ask-user-question coordinator.
 * @param options - Broadcast hooks, renderer availability, and id minting.
 * @returns The control port plus the settle and release entry points main wires
 *   to IPC and session teardown.
 */
export function createAskUserQuestionCoordinator({
	broadcastAsk,
	broadcastClosed,
	hasRenderer,
	createRequestId = randomUUID,
}: AskUserQuestionCoordinatorOptions): AskUserQuestionCoordinator {
	const pending = new Map<string, PendingAsk>();

	/**
	 * Removes a pending questionnaire, detaches its abort listener, and tells
	 * renderers to drop it — including the windows that did not answer it.
	 * @param requestId - Request to withdraw.
	 * @returns The removed entry, or null when the request was already settled.
	 */
	const withdraw = (requestId: string): PendingAsk | null => {
		const entry = pending.get(requestId);
		if (!entry) {
			return null;
		}
		entry.dispose();
		pending.delete(requestId);
		broadcastClosed({ requestId });
		return entry;
	};

	/**
	 * Reports whether a session already has a questionnaire on screen.
	 * @param sessionId - Session to check.
	 * @returns True when one of its questionnaires is still unanswered.
	 */
	const isAsking = (sessionId: string): boolean => {
		for (const entry of pending.values()) {
			if (entry.sessionId === sessionId) {
				return true;
			}
		}
		return false;
	};

	/**
	 * Resolves an ask immediately with a summary explaining why it never reached
	 * the user, so the agent can tell this apart from a decline.
	 * @param summary - The explanation to hand the agent.
	 * @returns The unanswered result.
	 */
	const unanswered = (summary: string): Promise<AskUserQuestionResult> =>
		Promise.resolve({ answers: [], cancelled: true, summary });

	const ask = ({
		origin,
		questions,
		signal,
	}: {
		origin: { sessionId: string; workspaceId: string };
		questions: readonly AskUserQuestionItem[];
		signal?: AbortSignal;
	}): Promise<AskUserQuestionResult> => {
		if (!hasRenderer()) {
			return unanswered(NO_RENDERER_SUMMARY);
		}
		if (isAsking(origin.sessionId)) {
			return unanswered(CONCURRENT_ASK_SUMMARY);
		}
		if (signal?.aborted) {
			return unanswered(ABANDONED_SUMMARY);
		}
		const requestId = createRequestId();
		const broadcast: AskUserQuestionBroadcast = {
			agentSessionId: origin.sessionId,
			questions,
			requestId,
			workspaceId: origin.workspaceId,
		};
		return new Promise<AskUserQuestionResult>((resolve) => {
			const onAbort = () => {
				withdraw(requestId)?.resolve({
					answers: [],
					cancelled: true,
					summary: ABANDONED_SUMMARY,
				});
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			pending.set(requestId, {
				broadcast,
				dispose: () => signal?.removeEventListener('abort', onAbort),
				resolve,
				sessionId: origin.sessionId,
			});
			broadcastAsk(broadcast);
		});
	};

	const settle = ({ answers, cancelled, requestId }: AskUserQuestionReply) => {
		withdraw(requestId)?.resolve(
			buildAskUserQuestionResult(answers, cancelled),
		);
	};

	const releaseSession = (sessionId: string): void => {
		for (const [requestId, entry] of pending) {
			if (entry.sessionId !== sessionId) {
				continue;
			}
			withdraw(requestId);
			entry.resolve(buildAskUserQuestionResult([], true));
		}
	};

	const openAsks = (): AskUserQuestionBroadcast[] =>
		[...pending.values()].map((entry) => entry.broadcast);

	return { openAsks, port: { ask, releaseSession }, settle };
}
