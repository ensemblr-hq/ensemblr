import { useEffect, useRef } from 'react';

import type { SessionTabModel } from '@/renderer/types/workbench';

import {
	findDuplicateTerminalTabIds,
	isLiveTerminalTab,
} from './terminal-tab-restore';

/**
 * Respawns harness terminal tabs whose PTY died with the previous app process.
 *
 * After a restart a terminal tab rehydrates with a `terminalId` pointing at a
 * PTY the previous process owned and killed. Each terminal tab is probed; a null
 * session means it is dead, so the harness is respawned and the tab repointed at
 * the new session. With a captured native session id the exact conversation is
 * reattached (`--resume <id>`), which is per-conversation and never collides, so
 * any number of same-harness tabs resume independently. Without an id (short or
 * fast-exiting tabs, or harnesses whose id lands late) it falls back to the cwd
 * `--continue` that reattaches the harness's most recent conversation — for the
 * first dead tab of a harness only; further same-harness tabs launch fresh so
 * they never collide on one shared log. The main handler persists the new
 * terminalId, so invalidating re-derives the tab against the live PTY.
 * @param closeSessionTabAsync - Archives a tab, awaited so failures self-heal
 * @param invalidateChatTabs - Refetches the tab list once a resume lands
 * @param sessionTabs - The workspace's current tabs
 * @param workspaceId - Workspace the resumed harness belongs to
 * @returns Claim and release for the restore path, which shares the resumed-tab set
 */
export function useTerminalTabAutoResume({
	closeSessionTabAsync,
	invalidateChatTabs,
	sessionTabs,
	workspaceId,
}: {
	closeSessionTabAsync: (tabId: string) => Promise<unknown>;
	invalidateChatTabs: () => void;
	sessionTabs: SessionTabModel[];
	workspaceId: string;
}) {
	// Terminal tabs a previous app session already respawned this session, so a
	// re-render never resumes the same tab twice. Reset naturally on app reload.
	const autoResumedTabIdsRef = useRef<Set<string>>(new Set());
	// Harness ids that already claimed the cwd-scoped `--continue` resume this app
	// session. When no native session id was captured we fall back to reattaching
	// the harness's most recent cwd conversation, but at most one tab per harness
	// may — two concurrent `--continue` would write and corrupt one shared log.
	const resumedHarnessIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		const api = window.ensemblr;
		if (!api) {
			return;
		}
		const resumed = autoResumedTabIdsRef.current;
		const resumedHarnessIds = resumedHarnessIdsRef.current;
		// A restart can leave several open terminal tabs bound to one captured
		// session id; archive the extras so the strip converges to a single live
		// tab per conversation instead of stale copies that would each `--resume`
		// and thrash one shared session log.
		const duplicateTabIds = new Set(findDuplicateTerminalTabIds(sessionTabs));

		for (const session of sessionTabs) {
			if (
				!isLiveTerminalTab(session) ||
				!session.harnessId ||
				resumed.has(session.id)
			) {
				continue;
			}
			resumed.add(session.id);
			if (duplicateTabIds.has(session.id)) {
				// Only restart-orphaned dead PTYs reach here: a live duplicate would be
				// claimed by the restore path and skipped by `resumed` above, so no
				// terminal teardown is needed. closeSessionTabAsync swallows a failed
				// close internally, so this fire-and-forget archive cannot leak a
				// rejection; a rare failure self-heals on the next app start.
				void closeSessionTabAsync(session.id);
				continue;
			}
			const {
				harnessSessionId,
				harnessId,
				id: chatTabId,
				terminalId,
			} = session;
			void api
				.terminalSnapshot({ terminalId })
				.then((snapshot) => {
					if (snapshot.session) {
						return;
					}
					// Exact-conversation resume when the native id was captured; it never
					// collides on a shared log. Without an id, fall back to the cwd
					// `--continue` — but only the first dead tab of a harness, since two
					// concurrent `--continue` would corrupt one shared log; extras launch
					// fresh. This mirrors the pre-exact-resume behavior so a tab whose id
					// never persisted still reattaches instead of opening a blank session.
					const cwdContinue =
						!harnessSessionId && !resumedHarnessIds.has(harnessId);
					if (cwdContinue) {
						resumedHarnessIds.add(harnessId);
					}
					return api
						.resumeAgentHarness({
							chatTabId,
							fresh: !harnessSessionId && !cwdContinue,
							harnessId,
							sessionId: harnessSessionId ?? undefined,
							workspaceId,
						})
						.then((result) => {
							if (result.session) {
								invalidateChatTabs();
								return;
							}
							resumed.delete(chatTabId);
							if (cwdContinue) {
								resumedHarnessIds.delete(harnessId);
							}
						});
				})
				.catch(() => {
					resumed.delete(chatTabId);
				});
		}
	}, [closeSessionTabAsync, invalidateChatTabs, sessionTabs, workspaceId]);

	return {
		claimTab: (tabId: string) => autoResumedTabIdsRef.current.add(tabId),
		releaseTab: (tabId: string) => autoResumedTabIdsRef.current.delete(tabId),
	};
}
