import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useMemo,
} from 'react';

import type { SessionTabModel } from '@/renderer/types/workbench';

import {
	type LiveTerminalTitle,
	resolveLiveTerminalTitle,
	sameLiveTerminalTitle,
} from './terminal-tab-title';

/** Where a harness terminal tab lives, keyed by the terminal id behind it. */
interface TerminalTabRef {
	harnessId: string;
	harnessLabel: string;
	tabId: string;
}

/**
 * Indexes the workspace's live terminal tabs by their backing terminal id, so a
 * lifecycle broadcast can find the tab it belongs to without rescanning.
 * @param sessionTabs - The workspace's current tabs
 * @returns Each terminal tab keyed by its terminal id
 */
function useTerminalTabsByTerminalId(
	sessionTabs: readonly SessionTabModel[],
): ReadonlyMap<string, TerminalTabRef> {
	return useMemo(() => {
		const map = new Map<string, TerminalTabRef>();
		for (const session of sessionTabs) {
			if (session.kind === 'terminal' && session.terminalId) {
				map.set(session.terminalId, {
					harnessId: session.harnessId,
					harnessLabel: session.harnessLabel,
					tabId: session.id,
				});
			}
		}
		return map;
	}, [sessionTabs]);
}

/**
 * Keeps each harness terminal tab's label in step with the title its PTY
 * reports, and closes the tab once the harness exits.
 *
 * The short and full forms travel as one value so a tab's label and its tooltip
 * can never be sourced from different titles. A stopped or exited harness is
 * archived as restorable; the caller's refs hold the final title and native
 * session id that the close path stamps onto the archived tab, which is why they
 * are written here rather than derived later.
 * @param closeSessionTab - Fire-and-forget close for a tab whose harness exited
 * @param sessionTabs - The workspace's current tabs
 * @param setTerminalTitles - Publishes the titles the tab strip renders
 * @param terminalSessionIdsRef - Mirror of the newest native session id per terminal
 * @param terminalTitlesRef - Mirror of the newest live title per terminal
 */
export function useTerminalTabLiveTitles({
	closeSessionTab,
	sessionTabs,
	setTerminalTitles,
	terminalSessionIdsRef,
	terminalTitlesRef,
}: {
	closeSessionTab: (tabId: string) => void;
	sessionTabs: readonly SessionTabModel[];
	setTerminalTitles: Dispatch<
		SetStateAction<Record<string, LiveTerminalTitle>>
	>;
	terminalSessionIdsRef: RefObject<Record<string, string>>;
	terminalTitlesRef: RefObject<Record<string, LiveTerminalTitle>>;
}): void {
	const terminalTabByTerminalId = useTerminalTabsByTerminalId(sessionTabs);

	useEffect(() => {
		if (terminalTabByTerminalId.size === 0) {
			return;
		}
		const unsubscribe = window.ensemblr?.onTerminalLifecycle((event) => {
			const tab = terminalTabByTerminalId.get(event.terminalId);
			if (!tab) {
				return;
			}
			if (event.session.harnessSessionId) {
				terminalSessionIdsRef.current[event.terminalId] =
					event.session.harnessSessionId;
			}
			const liveTitle = resolveLiveTerminalTitle(
				tab.harnessId,
				tab.harnessLabel,
				event.session,
			);
			if (liveTitle) {
				terminalTitlesRef.current[event.terminalId] = liveTitle;
			} else {
				delete terminalTitlesRef.current[event.terminalId];
			}
			if (event.session.status !== 'running') {
				closeSessionTab(tab.tabId);
				return;
			}
			setTerminalTitles((previous) =>
				nextTitleMap(previous, event.terminalId, liveTitle),
			);
		});
		return unsubscribe;
	}, [
		closeSessionTab,
		setTerminalTitles,
		terminalSessionIdsRef,
		terminalTabByTerminalId,
		terminalTitlesRef,
	]);
}

/**
 * Applies one terminal's new title to the title map, returning the same map when
 * nothing changed so a broadcast that repeats a title does not re-render.
 * @param previous - The title map currently held in state
 * @param terminalId - Terminal the broadcast was about
 * @param liveTitle - Its new title, or null when it no longer reports one
 * @returns The next map, or `previous` unchanged
 */
function nextTitleMap(
	previous: Record<string, LiveTerminalTitle>,
	terminalId: string,
	liveTitle: LiveTerminalTitle | null,
): Record<string, LiveTerminalTitle> {
	const current = previous[terminalId];
	if (liveTitle) {
		return sameLiveTerminalTitle(current, liveTitle)
			? previous
			: { ...previous, [terminalId]: liveTitle };
	}
	if (current === undefined) {
		return previous;
	}
	const next = { ...previous };
	delete next[terminalId];
	return next;
}
