import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
	agentSessionsForWorkspaceQuery,
	listChatTabSummariesQuery,
	listChatTabsQuery,
} from '@/renderer/api/ensemblr-queries';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { AgentSessionSnapshotWire } from '@/shared/ipc/contracts/agent-session';
import type { ChatTabSummaryEntryWire } from '@/shared/ipc/contracts/chat-tab';

import {
	toClosedSessionTabModel,
	toSessionTabModel,
} from './session-tab-model-mappers';
import type { LiveTerminalTitle } from './terminal-tab-title';

/**
 * Orders closed summary entries most-recently-closed first — the order the
 * history dropdown restores from, and the one main's summary-recency ranking
 * discards on its way to serving the attach chips.
 * @param left - First entry to compare
 * @param right - Second entry to compare
 * @returns Negative when `left` sorts first, positive when `right` does
 */
function byCloseRecency(
	left: ChatTabSummaryEntryWire,
	right: ChatTabSummaryEntryWire,
): number {
	return (right.closedAt ?? '').localeCompare(left.closedAt ?? '');
}

/**
 * Derives the workspace's open and closed tab models from the persisted rows,
 * overlaying each terminal tab's live OSC title and busy state, and resolves
 * which model the routed tab currently maps to.
 *
 * The synthetic `<workspaceId>:overview` placeholder is never a strip tab.
 * Surfacing it made opening the first real tab look like a replace: the array
 * swapped from `[placeholder]` to `[realTab]` at the 0→1 edge. Until the IPC
 * query lands (first paint, and every switch to a not-yet-cached workspace) the
 * strip is empty; the placeholder still backs `effectiveActiveSession` so
 * content keeps rendering meanwhile.
 * @param input - The routed tab, the workspace, and the live terminal overlays
 * @returns The tab models, the resolved active tab, the routed id once confirmed
 * to belong to this workspace, and whether it is still resolving
 */
export function useSessionTabModels({
	activeSession,
	activeWorkspace,
	busyTerminalIds,
	terminalTitles,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	busyTerminalIds: ReadonlySet<string>;
	terminalTitles: Record<string, LiveTerminalTitle>;
}) {
	const { i18n: i18nInstance } = useTranslation();
	const language = i18nInstance.language;
	const workspaceId = activeWorkspace.id;
	const {
		data: chatTabsData,
		isFetching: isFetchingChatTabs,
		isSuccess: hasLoadedChatTabs,
	} = useQuery(listChatTabsQuery(workspaceId));
	const { data: chatTabSummariesData } = useQuery(
		listChatTabSummariesQuery(workspaceId),
	);
	const { data: agentSessionsData } = useQuery(
		agentSessionsForWorkspaceQuery(workspaceId),
	);

	const openTabs = chatTabsData?.open ?? null;
	const summaryEntries = chatTabSummariesData?.entries;
	// The summary query lists open tabs too, ranked by summary recency so the
	// new-chat attach chips lead with the freshest transcript. The history
	// dropdown restores tabs rather than attaching them, so it speaks only for
	// the closed ones and re-ranks them by close time: a terminal tab never has a
	// transcript, and inheriting a transcript-based order buries the one closed a
	// minute ago under every chat that happens to carry a summary file.
	// Memoized because it feeds a dependency array: a fresh array per render
	// would rebuild every closed-tab model on every render.
	const closedEntries = useMemo(
		() =>
			summaryEntries
				?.filter((entry) => entry.closedAt !== null)
				.sort(byCloseRecency) ?? null,
		[summaryEntries],
	);
	const agentSessions = agentSessionsData?.sessions;

	const agentStatusByAgentSessionId = useMemo(() => {
		const map = new Map<string, AgentSessionSnapshotWire>();
		for (const session of agentSessions ?? []) {
			map.set(session.id, session);
		}
		return map;
	}, [agentSessions]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the mappers name untitled tabs and relative times through the i18n singleton, so the language is a real input Biome cannot see.
	const sessionTabs = useMemo<SessionTabModel[]>(() => {
		if (!openTabs) {
			return [];
		}
		return openTabs.map((tab) => {
			const model = toSessionTabModel(
				tab,
				agentStatusByAgentSessionId.get(tab.agentSessionId ?? ''),
			);
			if (model.kind !== 'terminal') {
				return model;
			}
			const liveTitle = terminalTitles[model.terminalId];
			return {
				...model,
				...(liveTitle
					? { fullLabel: liveTitle.full, label: liveTitle.display }
					: {}),
				...(busyTerminalIds.has(model.terminalId)
					? { status: 'working' as const }
					: {}),
			};
		});
	}, [
		agentStatusByAgentSessionId,
		busyTerminalIds,
		language,
		openTabs,
		terminalTitles,
	]);

	const resolvedActiveSession = useMemo(
		() =>
			sessionTabs.find((session) => session.id === activeSession.id) ?? null,
		[activeSession.id, sessionTabs],
	);
	// The routed tab exists but the list has not caught up with it yet (first
	// paint, just opened, just restored, focused by an agent). Callers must treat
	// the tab as not-yet-usable: it is a real tab, so nothing rejects a submit on
	// its id, but its agent session is unknown and a submit would read as a fresh
	// chat and open a second session over the one the tab already owns.
	const isResolvingActiveSession =
		resolvedActiveSession === null &&
		(!hasLoadedChatTabs || isFetchingChatTabs);

	// An unresolved routed tab id resolves to itself with nothing attached rather
	// than to a neighbour: substituting another tab's model here hands its agent
	// session to a tab that does not own it, and the composer then steers that
	// session.
	const effectiveActiveSession = useMemo<SessionTabModel>(() => {
		if (resolvedActiveSession) {
			return resolvedActiveSession;
		}
		if (isResolvingActiveSession) {
			return { ...activeSession, agentSessionId: null, status: 'idle' };
		}
		return (
			sessionTabs[0] ??
			activeWorkspace.sessions.find(
				(session) => session.id === activeSession.id,
			) ??
			activeWorkspace.sessions[0] ??
			activeSession
		);
	}, [
		activeSession,
		activeWorkspace.sessions,
		isResolvingActiveSession,
		resolvedActiveSession,
		sessionTabs,
	]);

	return {
		// biome-ignore lint/correctness/useExhaustiveDependencies: the mapper names untitled tabs and relative times through the i18n singleton, so the language is a real input Biome cannot see.
		closedSessions: useMemo<SessionTabModel[]>(
			() => (closedEntries ?? []).map(toClosedSessionTabModel),
			[closedEntries, language],
		),
		effectiveActiveSession,
		/** True once the tab list has settled, so a bootstrap can trust an empty result. */
		hasSettledTabList: hasLoadedChatTabs && !isFetchingChatTabs,
		isResolvingActiveSession,
		openTabCount: openTabs?.length ?? null,
		/**
		 * The routed tab id, but only once confirmed to be an open tab of this
		 * workspace — null while resolving and for a routed id this workspace does
		 * not own. What the per-workspace last-active-chat memory is written from,
		 * since `effectiveActiveSession` substitutes a neighbour in those cases.
		 */
		resolvedActiveChatId: resolvedActiveSession?.id ?? null,
		sessionTabs,
	};
}
