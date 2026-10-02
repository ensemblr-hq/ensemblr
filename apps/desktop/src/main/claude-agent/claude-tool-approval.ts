/**
 * Per-tool approval gate for Claude's `approval-required` mode. The Agent SDK
 * calls `canUseTool` from its control-request dispatcher — a different async
 * task from the streaming-input generator — so awaiting the user here blocks the
 * tool, not the message pump. That is the whole point of the gate, and it is
 * also why nothing may leave a request pending: a prompt with no answer and no
 * withdrawal parks the tool call forever, since permission prompts have no
 * deadline of their own.
 *
 * Every escape hatch therefore lands in `withdraw`: the SDK's per-request abort
 * (what `interrupt()` produces), session stop, session close, and app shutdown.
 *
 * The gate leans towards allow only while the app is running and merely has no
 * window to draw a card in. Once the quit path calls `shutdown` it fails closed
 * instead: a deny also resolves at once, so denying hangs nothing, and there is
 * nobody left watching the UI for whom an unprompted allow could be explained.
 *
 * Claude only. Pi has full workspace control and never reaches this module.
 */
import { randomUUID } from 'node:crypto';

import type {
	ToolApprovalClosedBroadcast,
	ToolApprovalDecision,
	ToolApprovalRequestedBroadcast,
} from '../../shared/agent-tool-approval.ts';
import { toToolApprovalInputPreview } from '../../shared/agent-tool-approval.ts';
import type { ScopedToolApprovalReply } from '../../shared/ipc/contracts/agent-tool-approval.ts';
import type {
	ClaudeCanUseTool,
	ClaudeSessionApproval,
} from './claude-permission-bridge.ts';

/** Collaborators for {@link createClaudeToolApprovalCoordinator}. */
export interface ClaudeToolApprovalCoordinatorOptions {
	/** Pushes a pending tool call to every renderer window. */
	broadcastRequested: (payload: ToolApprovalRequestedBroadcast) => void;
	/** Tells renderers a pending prompt is no longer answerable. */
	broadcastClosed: (payload: ToolApprovalClosedBroadcast) => void;
	/** Whether any window is available to host the card. */
	hasRenderer: () => boolean;
	/** Overrides request-id minting; defaults to a random UUID. */
	createRequestId?: () => string;
}

/** Public surface of the approval coordinator. */
export interface ClaudeToolApprovalCoordinator {
	/**
	 * Opens the gate for one session. The adapter calls this once per session, so
	 * the allow-for-session list and the prompts it raised die with that session.
	 */
	openSession: (session: { agentSessionId: string }) => ClaudeSessionApproval;
	/**
	 * Settles a pending prompt with the user's decision, provided the reply names
	 * the session the request belongs to. An unknown id and a mismatched session
	 * are both ignored, so neither a late answer nor another chat's window can
	 * throw across the IPC boundary or unblock a tool call it does not own.
	 */
	settle: (reply: ScopedToolApprovalReply) => void;
	/**
	 * Every prompt still waiting on the user, as the broadcasts that announced
	 * them. A renderer holds pending prompts in memory only, so a window that
	 * reloads or opens late replays these to get back in step — without them the
	 * card is gone while the tool call stays blocked.
	 */
	openRequests: () => ToolApprovalRequestedBroadcast[];
	/**
	 * Fails the gate closed for the rest of the process's life: withdraws every
	 * prompt on screen and denies every tool call that arrives afterwards, in any
	 * session. The quit path calls this before the shutdown grace period, where
	 * the windows are already gone but a session can still be pumping messages —
	 * allowing unprompted there would run Claude's writes behind the user's back
	 * at the exact moment they believe they closed the agent.
	 */
	shutdown: () => void;
}

/** Denial message when the turn was interrupted before the user decided. */
const ABORTED_MESSAGE =
	'The turn was interrupted before the user answered this permission request.';

/** Denial message when the session ended with the prompt still on screen. */
const SESSION_ENDED_MESSAGE =
	'The session ended before the user answered this permission request.';

/** Denial message when the user declined without typing a reason. */
const DECLINED_MESSAGE = 'The user declined this tool call.';

/** Denial message for a tool call raised once the app started quitting. */
const QUITTING_MESSAGE =
	'Ensemblr is quitting, so this tool call was denied unprompted.';

/** Logged once per session when approval-required has nowhere to prompt. */
const NO_RENDERER_WARNING =
	'[claude-agent] approval-required has no window to prompt in; allowing this tool call unprompted.';

/** A prompt waiting on the user, keyed by its request id. */
interface PendingApproval {
	agentSessionId: string;
	/** Settles the blocked `canUseTool` promise. */
	resolve: (decision: ToolApprovalDecision) => void;
	/** Detaches the abort listener the SDK's per-request controller drives. */
	dispose: () => void;
	/** The announcement to replay to a renderer that missed or lost it. */
	broadcast: ToolApprovalRequestedBroadcast;
}

/**
 * Creates a one-shot gate the next queued tool call waits on.
 * @returns The promise to await and the function that opens it.
 */
function createLatch(): { wait: Promise<void>; release: () => void } {
	let release = (): void => undefined;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { release, wait };
}

/**
 * Builds the approval coordinator that backs `approval-required`.
 * @param options - Broadcast hooks, renderer availability, and id minting.
 * @returns The per-session gate factory plus the settle, replay, and fail-closed
 * shutdown entry points.
 */
export function createClaudeToolApprovalCoordinator({
	broadcastRequested,
	broadcastClosed,
	hasRenderer,
	createRequestId = randomUUID,
}: ClaudeToolApprovalCoordinatorOptions): ClaudeToolApprovalCoordinator {
	const pending = new Map<string, PendingApproval>();
	const openSessions = new Set<() => void>();
	let quitting = false;

	/**
	 * Removes a pending prompt, detaches its abort listener, and tells every
	 * renderer to drop the card — including windows that did not answer it.
	 * @param requestId - Request to withdraw.
	 * @returns The removed entry, or null when it was already settled.
	 */
	const withdraw = (requestId: string): PendingApproval | null => {
		const entry = pending.get(requestId);
		if (!entry) {
			return null;
		}
		entry.dispose();
		pending.delete(requestId);
		broadcastClosed({ requestId });
		return entry;
	};

	const settle = ({
		agentSessionId,
		decision,
		requestId,
	}: ScopedToolApprovalReply): void => {
		if (pending.get(requestId)?.agentSessionId !== agentSessionId) {
			return;
		}
		withdraw(requestId)?.resolve(decision);
	};

	const openRequests = (): ToolApprovalRequestedBroadcast[] =>
		[...pending.values()].map((entry) => entry.broadcast);

	const shutdown = (): void => {
		quitting = true;
		for (const releaseSession of [...openSessions]) {
			releaseSession();
		}
	};

	const openSession = ({
		agentSessionId,
	}: {
		agentSessionId: string;
	}): ClaudeSessionApproval => {
		const allowedForSession = new Set<string>();
		let warnedWithoutRenderer = false;
		let released = false;
		let queue: Promise<void> = Promise.resolve();

		/**
		 * Raises one prompt and resolves when the user decides, the SDK aborts the
		 * request, or the session is released.
		 * @param broadcast - The announcement, already minted with its request id.
		 * @param signal - The SDK's per-request abort signal.
		 * @returns The decision that settles the tool call.
		 */
		const prompt = (
			broadcast: ToolApprovalRequestedBroadcast,
			signal: AbortSignal,
		): Promise<ToolApprovalDecision> =>
			new Promise<ToolApprovalDecision>((resolve) => {
				const onAbort = () => {
					withdraw(broadcast.requestId)?.resolve({
						kind: 'deny',
						reason: ABORTED_MESSAGE,
					});
				};
				signal.addEventListener('abort', onAbort, { once: true });
				pending.set(broadcast.requestId, {
					agentSessionId,
					broadcast,
					dispose: () => signal.removeEventListener('abort', onAbort),
					resolve,
				});
				broadcastRequested(broadcast);
			});

		/**
		 * Decides one tool call, once it holds the session's turn on the card.
		 * @param toolName - Tool Claude asked to run.
		 * @param input - The tool's arguments, returned unchanged on an allow.
		 * @param options - The SDK's per-request context, including its abort signal.
		 * @returns The permission result to hand back to the SDK.
		 */
		const decide: ClaudeCanUseTool = async (toolName, input, options) => {
			if (quitting) {
				return { behavior: 'deny', message: QUITTING_MESSAGE };
			}
			if (released) {
				return { behavior: 'deny', message: SESSION_ENDED_MESSAGE };
			}
			if (allowedForSession.has(toolName)) {
				return { behavior: 'allow', updatedInput: input };
			}
			if (!hasRenderer()) {
				if (!warnedWithoutRenderer) {
					warnedWithoutRenderer = true;
					console.warn(NO_RENDERER_WARNING, { toolName });
				}
				return { behavior: 'allow', updatedInput: input };
			}
			if (options.signal.aborted) {
				return { behavior: 'deny', message: ABORTED_MESSAGE };
			}

			const decision = await prompt(
				{
					agentSessionId,
					input: toToolApprovalInputPreview(input),
					requestId: createRequestId(),
					toolName,
					...(options.description ? { description: options.description } : {}),
					...(options.displayName ? { displayName: options.displayName } : {}),
					...(options.title ? { title: options.title } : {}),
				},
				options.signal,
			);

			if (decision.kind === 'deny') {
				return {
					behavior: 'deny',
					message: decision.reason?.trim() || DECLINED_MESSAGE,
				};
			}
			if (decision.kind === 'allow-for-session') {
				allowedForSession.add(toolName);
			}
			return { behavior: 'allow', updatedInput: input };
		};

		// One assistant message can carry several tool calls, and the SDK gates each
		// one separately. The composer slot holds a single card, so a second prompt
		// would replace the first on screen while the first stayed blocked with
		// nothing left to answer it. Queueing keeps card and pending set in step.
		const canUseTool: ClaudeCanUseTool = async (toolName, input, options) => {
			const earlier = queue;
			const turn = createLatch();
			queue = turn.wait;
			try {
				await earlier;
				return await decide(toolName, input, options);
			} finally {
				turn.release();
			}
		};

		const release = (): void => {
			released = true;
			openSessions.delete(release);
			allowedForSession.clear();
			for (const [requestId, entry] of [...pending]) {
				if (entry.agentSessionId !== agentSessionId) {
					continue;
				}
				withdraw(requestId)?.resolve({
					kind: 'deny',
					reason: SESSION_ENDED_MESSAGE,
				});
			}
		};

		openSessions.add(release);
		return { canUseTool, release };
	};

	return { openRequests, openSession, settle, shutdown };
}
