/**
 * Blocking question channel between an agent and the human. `askUserQuestion`
 * holds the agent's control call open while the renderer shows the questionnaire
 * in the chat tab that asked it, then settles when the user answers, dismisses,
 * the wait runs out, or the session goes away.
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
	/** Overrides how long a questionnaire may wait unanswered. */
	timeoutMs?: number;
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
}

/** A questionnaire waiting on the user, keyed by its request id. */
interface PendingAsk {
	sessionId: string;
	resolve: (result: AskUserQuestionResult) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * How long a questionnaire may sit unanswered before the agent is released.
 * Generous: the dialog takes over the composer, so the user has to deal with it
 * to keep chatting — this only catches a chat left alone for the afternoon.
 */
const ASK_TIMEOUT_MS = 1_800_000;

/** Told to the agent when no window exists to render the questionnaire. */
const NO_RENDERER_SUMMARY =
	'No Ensemblr window was available to show the question, so the user never saw it. Do not treat this as a decline — ask in your reply instead.';

/** Told to the agent when it already has a questionnaire on screen. */
const CONCURRENT_ASK_SUMMARY =
	'This conversation already has a question waiting on the user, so this one was not shown. Do not treat this as a decline — wait for the first answer, and ask related questions in a single call.';

/** Told to the agent when the user left the questionnaire unanswered too long. */
const TIMED_OUT_SUMMARY =
	'The user did not answer in time and the question was withdrawn. Do not treat this as a decline — proceed on your best judgement, or ask again in your reply.';

/**
 * Creates the ask-user-question coordinator.
 * @param options - Broadcast hooks, renderer availability, id minting, and the
 *   unanswered-question timeout.
 * @returns The control port plus the settle and release entry points main wires
 *   to IPC and session teardown.
 */
export function createAskUserQuestionCoordinator({
	broadcastAsk,
	broadcastClosed,
	hasRenderer,
	createRequestId = randomUUID,
	timeoutMs = ASK_TIMEOUT_MS,
}: AskUserQuestionCoordinatorOptions): AskUserQuestionCoordinator {
	const pending = new Map<string, PendingAsk>();

	/**
	 * Removes a pending questionnaire, stops its timer, and tells renderers to
	 * drop it — including the windows that did not answer it.
	 * @param requestId - Request to withdraw.
	 * @returns The removed entry, or null when the request was already settled.
	 */
	const withdraw = (requestId: string): PendingAsk | null => {
		const entry = pending.get(requestId);
		if (!entry) {
			return null;
		}
		clearTimeout(entry.timer);
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
	}: {
		origin: { sessionId: string; workspaceId: string };
		questions: readonly AskUserQuestionItem[];
	}): Promise<AskUserQuestionResult> => {
		if (!hasRenderer()) {
			return unanswered(NO_RENDERER_SUMMARY);
		}
		if (isAsking(origin.sessionId)) {
			return unanswered(CONCURRENT_ASK_SUMMARY);
		}
		const requestId = createRequestId();
		return new Promise<AskUserQuestionResult>((resolve) => {
			const timer = setTimeout(() => {
				withdraw(requestId)?.resolve({
					answers: [],
					cancelled: true,
					summary: TIMED_OUT_SUMMARY,
				});
			}, timeoutMs);
			timer.unref?.();
			pending.set(requestId, { resolve, sessionId: origin.sessionId, timer });
			broadcastAsk({
				piSessionId: origin.sessionId,
				questions,
				requestId,
				workspaceId: origin.workspaceId,
			});
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

	return { port: { ask, releaseSession }, settle };
}
