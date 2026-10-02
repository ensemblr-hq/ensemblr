import { type RefObject, useCallback, useRef } from 'react';

import type { SessionTabModel } from '@/renderer/types/workbench';
import type { CloseChatTabRequest } from '@/shared/ipc/contracts/chat-tab';

import { selectSuccessorTabId } from './session-tab-close';
import type { LiveTerminalTitle } from './terminal-tab-title';

/** Fields a close stamps onto the archived tab row. */
type ClosePatch = Pick<
	CloseChatTabRequest,
	'fullTitle' | 'metadataPatch' | 'title'
>;

/**
 * Whether a chat tab is the workspace's last one, which the min-one rule keeps
 * open. Non-chat tabs are always closable.
 * @param sessionTabs - The workspace's current tabs
 * @param closing - The tab being closed, when it is still in the list
 * @returns True when closing this tab would leave the workspace with no chat
 */
function isLastChatTab(
	sessionTabs: readonly SessionTabModel[],
	closing: SessionTabModel | undefined,
): boolean {
	if ((closing?.kind ?? 'chat') !== 'chat') {
		return false;
	}
	return (
		sessionTabs.filter((session) => (session.kind ?? 'chat') === 'chat')
			.length <= 1
	);
}

/**
 * Closing a session tab: the min-one-chat rule, handing focus to a successor,
 * tearing down a terminal tab's PTY, and stamping the archived row.
 *
 * A tab whose close is already in flight is ignored, so the harness-exit
 * lifecycle event cannot re-close a tab the user just closed — a kill triggers a
 * synchronous exit broadcast that would otherwise fire a second close on the
 * same row.
 * @param input - The current tabs, the active tab, and the persistence seam
 * @returns The async and fire-and-forget close callbacks
 */
export function useSessionTabCloseFlow({
	activeSessionId,
	closeChatTab,
	onSessionTabChange,
	readVisitOrder,
	sessionTabs,
	terminalSessionIdsRef,
	terminalTitlesRef,
}: {
	activeSessionId: string;
	closeChatTab: (input: CloseChatTabRequest) => Promise<unknown>;
	onSessionTabChange: (chatTabId: string) => void;
	readVisitOrder: () => string[] | undefined;
	sessionTabs: SessionTabModel[];
	terminalSessionIdsRef: RefObject<Record<string, string>>;
	terminalTitlesRef: RefObject<Record<string, LiveTerminalTitle>>;
}) {
	// Tab ids whose close is already in flight, so the harness-exit lifecycle
	// event cannot re-close a tab the user just closed.
	const closingTabIdsRef = useRef<Set<string>>(new Set());

	const closeSessionTabAsync = useCallback(
		async (
			chatTabId: string,
			patch?: Pick<CloseChatTabRequest, 'metadataPatch' | 'title'>,
		): Promise<{ replacementChatTabId: string | null }> => {
			try {
				await closeChatTab({ chatTabId, ...patch });
			} catch {
				// The mutation's onError already rolls back the optimistic removal, so
				// the many fire-and-forget callers can `void` this without leaking an
				// unhandled rejection on a failed close.
			}
			return { replacementChatTabId: null };
		},
		[closeChatTab],
	);

	/**
	 * For a closing terminal (harness) tab, kills its live PTY and returns the
	 * close patch stamping the final title + native harness session id onto the
	 * archived tab so the history row shows the conversation and a restore can
	 * reattach it. Returns undefined for non-terminal tabs, which need no sidecar
	 * teardown.
	 */
	const closeTerminalSidecar = useCallback(
		(closing: SessionTabModel | undefined): ClosePatch | undefined => {
			if (closing?.kind !== 'terminal' || !closing.terminalId) {
				return undefined;
			}
			const terminalId = closing.terminalId;
			void window.ensemblr?.killTerminalSession({ terminalId });
			const title = terminalTitlesRef.current[terminalId];
			const harnessSessionId =
				terminalSessionIdsRef.current[terminalId] ??
				closing.harnessSessionId ??
				null;
			// The PTY is gone once closed; drop its ref entries so the maps do not
			// accumulate across a long-lived workspace of spawned/closed terminals.
			delete terminalTitlesRef.current[terminalId];
			delete terminalSessionIdsRef.current[terminalId];
			// Only patch the id when one was captured. Writing null here would clobber
			// a previously-persisted id (e.g. a tab closed before a re-poll), leaving
			// the archived tab unresumable and forcing a fresh session on restore.
			return {
				...(harnessSessionId ? { metadataPatch: { harnessSessionId } } : {}),
				...(title ? { fullTitle: title.full, title: title.display } : {}),
			};
		},
		[terminalSessionIdsRef, terminalTitlesRef],
	);

	/** Fire-and-forget close used by the SessionTabState contract. */
	const closeSessionTab = useCallback(
		(chatTabId: string) => {
			if (closingTabIdsRef.current.has(chatTabId)) {
				return;
			}
			const closingIndex = sessionTabs.findIndex(
				(session) => session.id === chatTabId,
			);
			const closing = closingIndex >= 0 ? sessionTabs[closingIndex] : undefined;
			if (isLastChatTab(sessionTabs, closing)) {
				return;
			}
			closingTabIdsRef.current.add(chatTabId);
			const nextSessionId = selectSuccessorTabId(sessionTabs, {
				closingIndex,
				visitOrder: readVisitOrder(),
			});
			if (activeSessionId === chatTabId && nextSessionId) {
				onSessionTabChange(nextSessionId);
			}
			void closeSessionTabAsync(chatTabId, closeTerminalSidecar(closing))
				.then((result) => {
					if (result.replacementChatTabId) {
						onSessionTabChange(result.replacementChatTabId);
					}
				})
				.finally(() => {
					closingTabIdsRef.current.delete(chatTabId);
				});
		},
		[
			activeSessionId,
			closeSessionTabAsync,
			closeTerminalSidecar,
			onSessionTabChange,
			readVisitOrder,
			sessionTabs,
		],
	);

	return { closeSessionTab, closeSessionTabAsync };
}
