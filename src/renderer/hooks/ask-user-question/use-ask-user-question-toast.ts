import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { pendingAskUserQuestionsAtom } from '@/renderer/state/ask-user-question';
import {
	activeChatIdentityAtom,
	pendingNotificationFocusAtom,
} from '@/renderer/state/unread';

const TOAST_ID_PREFIX = 'ask-user-question:';

/**
 * Shows persistent warning toasts for new agent questions outside the chat the
 * user is currently viewing, keeping visible toast copy in the app's language.
 */
export function useAskUserQuestionToast(): void {
	const { t } = useTranslation('workbench');
	const pending = useAtomValue(pendingAskUserQuestionsAtom);
	const activeChat = useAtomValue(activeChatIdentityAtom);
	const setPendingFocus = useSetAtom(pendingNotificationFocusAtom);
	const seenRequestIds = useRef(new Set<string>());
	const shownToastIds = useRef(new Map<string, string>());
	const previousTranslation = useRef(t);

	useEffect(() => {
		const translationChanged = previousTranslation.current !== t;
		previousTranslation.current = t;
		const requests = Object.values(pending);
		const requestsById = new Map(
			requests.map((request) => [request.requestId, request]),
		);
		for (const requestId of seenRequestIds.current) {
			if (!requestsById.has(requestId)) {
				seenRequestIds.current.delete(requestId);
			}
		}
		for (const [requestId, toastId] of shownToastIds.current) {
			const request = requestsById.get(requestId);
			const isFocused =
				request !== undefined &&
				activeChat !== null &&
				request.workspaceId === activeChat.workspaceId &&
				request.agentSessionId === activeChat.agentSessionId;
			if (!request || isFocused) {
				toast.dismiss(toastId);
				shownToastIds.current.delete(requestId);
			}
		}

		for (const request of requests) {
			if (
				seenRequestIds.current.has(request.requestId) &&
				(!translationChanged || !shownToastIds.current.has(request.requestId))
			) {
				continue;
			}
			seenRequestIds.current.add(request.requestId);
			const isFocused =
				activeChat !== null &&
				request.workspaceId === activeChat.workspaceId &&
				request.agentSessionId === activeChat.agentSessionId;
			if (request.workspaceId.length === 0 || isFocused) {
				continue;
			}

			const toastId = `${TOAST_ID_PREFIX}${request.requestId}`;
			shownToastIds.current.set(request.requestId, toastId);
			toast.warning(
				t('ask-user-question-toast.title', 'Agent needs your input'),
				{
					action: {
						label: t('ask-user-question-toast.focus', 'Focus chat'),
						onClick: () => {
							shownToastIds.current.delete(request.requestId);
							setPendingFocus({
								agentSessionId: request.agentSessionId,
								chatTabId: null,
								workspaceId: request.workspaceId,
							});
						},
					},
					classNames: {
						description: 'line-clamp-2 text-popover-foreground/75!',
						icon: 'text-status-warning!',
						warning: 'border-status-warning/50! text-popover-foreground!',
					},
					closeButton: true,
					description: request.questions[0]?.question,
					duration: Number.POSITIVE_INFINITY,
					id: toastId,
					onDismiss: () => shownToastIds.current.delete(request.requestId),
					style: {
						background:
							'color-mix(in oklab, var(--ensemblr-status-warning) 12%, var(--popover))',
					},
				},
			);
		}
	}, [activeChat, pending, setPendingFocus, t]);

	useEffect(() => {
		const toastIds = shownToastIds.current;
		const seenIds = seenRequestIds.current;
		return () => {
			for (const toastId of toastIds.values()) {
				toast.dismiss(toastId);
			}
			toastIds.clear();
			seenIds.clear();
		};
	}, []);
}
