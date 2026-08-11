import { useAtomValue, useStore } from 'jotai';
import { useEffect, useRef } from 'react';

import { subscribeAgentSessionEvents } from '@/renderer/api/ensemblr';
import { isFinishedTurnEvent } from '@/renderer/hooks/workbench-shell/route-layout/detect-pull-request-creation';
import { pendingAskUserQuestionsAtom } from '@/renderer/state/ask-user-question';
import {
	type ActiveChatIdentity,
	activeChatIdentityAtom,
	useUnreadChatActions,
} from '@/renderer/state/unread';
import { useWorkspaceBoardActions } from '@/renderer/state/workspace';
import type { AskUserQuestionBroadcast } from '@/shared/agent-control';

/** Reads an event's ISO timestamp, falling back to now when it is unparseable. */
function toTimestamp(createdAt: string): number {
	const parsed = Date.parse(createdAt);
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
		const unsubscribe = subscribeAgentSessionEvents((broadcast) => {
			const envelope = broadcast.event.payload;
			if (!envelope || !isFinishedTurnEvent(envelope)) {
				return;
			}
			if (
				isOnScreen(
					store.get(activeChatIdentityAtom),
					broadcast.workspaceId,
					broadcast.sessionId,
				)
			) {
				return;
			}
			markChat({
				agentSessionId: broadcast.sessionId,
				chatTabId: null,
				lastMessageAt: toTimestamp(broadcast.event.createdAt),
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
