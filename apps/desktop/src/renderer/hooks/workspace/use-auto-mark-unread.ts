import { useAtomValue, useStore } from 'jotai';
import { useEffect, useRef } from 'react';

import { subscribeChatTurnFinished } from '@/renderer/api/ensemblr';
import { pendingAskUserQuestionsAtom } from '@/renderer/state/ask-user-question';
import {
	type ActiveChatIdentity,
	activeChatIdentityAtom,
	useUnreadChatActions,
} from '@/renderer/state/unread';
import { useWorkspaceBoardActions } from '@/renderer/state/workspace';
import type { AskUserQuestionBroadcast } from '@/shared/agent-control';

/** Reads a broadcast's ISO timestamp, falling back to now when unparseable. */
function toTimestamp(finishedAt: string): number {
	const parsed = Date.parse(finishedAt);
	return Number.isNaN(parsed) ? Date.now() : parsed;
}

/** Whether the chat on screen is the one this session drives. */
function isOnScreen(
	activeChat: ActiveChatIdentity | null,
	workspaceId: string,
	agentSessionId: string,
): boolean {
	return (
		activeChat !== null &&
		activeChat.workspaceId === workspaceId &&
		activeChat.agentSessionId === agentSessionId
	);
}

/** Drops request ids that are no longer pending, bounding the marked-once set. */
function pruneAnsweredQuestions(
	marked: Set<string>,
	pending: readonly AskUserQuestionBroadcast[],
): void {
	const stillPending = new Set(pending.map((question) => question.requestId));
	for (const requestId of marked) {
		if (!stillPending.has(requestId)) {
			marked.delete(requestId);
		}
	}
}

/**
 * Marks chats unread from agent activity anywhere in the app: a turn that
 * finishes, or a questionnaire an agent is blocked on. A chat the user is
 * looking at is never marked, and viewing a chat is what clears it — see
 * `usePublishActiveChat`.
 *
 * Finished turns arrive already judged worth the user's attention, from the
 * same main-process decision the desktop notifier hangs off. Deriving them here
 * from the raw session-event stream instead would re-mark what that decision
 * refuses: a sub-agent's chat, whose completion is its orchestrator's business,
 * and the `idle` that trails a stop the user asked for. Neither is visible from
 * a persisted event. Questionnaires stay local, because whether one still wants
 * the user is renderer state — a question seen and left unanswered re-arms, and
 * main has no way to know it was seen.
 *
 * One global subscription (not one per row) covers every workspace, so a
 * background agent surfaces the moment it goes idle even from the welcome
 * screen. The subscription reads the chat on screen out of the store at event
 * time rather than from a mirrored ref: the identity is published by a
 * descendant, so a ref synced in this component's own effect would still hold
 * the previous value for the commit in between, and a turn landing there would
 * mark the very chat the user is watching.
 *
 * A questionnaire marks at most once per request id, but only once it is
 * off-screen — one raised in the chat on screen re-arms when the user leaves it
 * still unanswered, which is why this effect subscribes to the identity rather
 * than reading it out of the store.
 * @param activeWorkspaceId - The currently open workspace id, or null
 */
export function useAutoMarkUnread(activeWorkspaceId: string | null): void {
	const store = useStore();
	const { markChat } = useUnreadChatActions();
	const { markWorkspaceRead } = useWorkspaceBoardActions();
	const activeChat = useAtomValue(activeChatIdentityAtom);
	const pendingQuestions = useAtomValue(pendingAskUserQuestionsAtom);
	const markedQuestionsRef = useRef(new Set<string>());

	useEffect(() => {
		const unsubscribe = subscribeChatTurnFinished((broadcast) => {
			if (
				isOnScreen(
					store.get(activeChatIdentityAtom),
					broadcast.workspaceId,
					broadcast.agentSessionId,
				)
			) {
				return;
			}
			markChat({
				agentSessionId: broadcast.agentSessionId,
				chatTabId: broadcast.chatTabId,
				lastMessageAt: toTimestamp(broadcast.finishedAt),
				reason: 'turn-finished',
				workspaceId: broadcast.workspaceId,
			});
		});
		return unsubscribe;
	}, [markChat, store]);

	useEffect(() => {
		const questions = Object.values(pendingQuestions);
		const marked = markedQuestionsRef.current;
		pruneAnsweredQuestions(marked, questions);

		for (const question of questions) {
			if (marked.has(question.requestId)) {
				continue;
			}
			// The Concierge belongs to no workspace and holds no chat tab, so an
			// entry made for its question names a chat that does not exist: nothing
			// could ever clear it, and it would evict real marks from the capped
			// list. Its panel is the surface that shows the question.
			if (question.workspaceId === '') {
				continue;
			}
			if (
				isOnScreen(activeChat, question.workspaceId, question.agentSessionId)
			) {
				continue;
			}
			marked.add(question.requestId);
			markChat({
				agentSessionId: question.agentSessionId,
				chatTabId: null,
				lastMessageAt: Date.now(),
				reason: 'question',
				workspaceId: question.workspaceId,
			});
		}
	}, [activeChat, markChat, pendingQuestions]);

	useEffect(() => {
		if (activeWorkspaceId) {
			markWorkspaceRead(activeWorkspaceId);
		}
	}, [activeWorkspaceId, markWorkspaceRead]);
}
