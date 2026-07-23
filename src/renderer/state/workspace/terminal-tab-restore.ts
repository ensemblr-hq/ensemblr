import { toast } from 'sonner';
import type { SessionTabModel } from '@/renderer/types/workbench';
import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';

/** Collaborators the restore flow needs from the owning session-tab hook. */
export interface RestoreTerminalTabDeps {
	/** Workspace the restored tab belongs to. */
	workspaceId: string;
	/** Tabs currently open, used to detect an already-open conversation. */
	sessionTabs: SessionTabModel[];
	/** Marks a tab as auto-resumed so the post-restart effect skips it. */
	claimTab: (chatTabId: string) => void;
	/** Releases a claim when the resume fails. */
	releaseTab: (chatTabId: string) => void;
	/** Closes a tab (used to drop a duplicate of an already-open conversation). */
	closeTab: (chatTabId: string) => Promise<unknown>;
	/** Invalidates the chat-tab queries so the strip re-derives from storage. */
	invalidate: () => void;
	/** Selects a tab by id. */
	selectTab: (chatTabId: string) => void;
}

/**
 * Reads a wire-metadata field as a non-empty string, or undefined when absent.
 * @param value - The raw metadata value.
 * @returns The trimmed string, or undefined when missing or blank.
 */
function metadataText(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A terminal (harness) session tab, narrowed from the `SessionTabModel` union. */
type TerminalSessionTab = Extract<SessionTabModel, { kind: 'terminal' }>;

/**
 * Narrows a session tab to a live PTY-backed terminal tab: kind `terminal` with a
 * non-empty `terminalId`. Restart-orphaned or not-yet-spawned tabs carry an empty
 * id and are excluded, so a match is always an attachable conversation.
 * @param session - The session tab to test.
 * @returns True when the tab is a terminal tab backed by a live terminal id.
 */
export function isLiveTerminalTab(
	session: SessionTabModel,
): session is TerminalSessionTab {
	return session.kind === 'terminal' && session.terminalId.length > 0;
}

/**
 * Finds an open terminal tab already attached to the given native session id, so
 * a restore focuses it instead of spawning a second PTY against one shared log.
 * @param sessionTabs - The currently open tabs.
 * @param agentSessionId - The native session id to match, or undefined to skip.
 * @param excludeId - The restored tab's id to exclude from the match.
 * @returns The matching open tab, or undefined when none is open.
 */
function findOpenConversation(
	sessionTabs: SessionTabModel[],
	agentSessionId: string | undefined,
	excludeId: string,
): SessionTabModel | undefined {
	if (!agentSessionId) {
		return undefined;
	}
	return sessionTabs.find(
		(session) =>
			isLiveTerminalTab(session) &&
			session.agentSessionId === agentSessionId &&
			session.id !== excludeId,
	);
}

/**
 * Finds restart-orphaned duplicate terminal tabs: open tabs that share a
 * captured `agentSessionId` with an earlier tab in the strip. A restart can
 * leave several open terminal tabs bound to one conversation (an earlier build
 * inserted a fresh tab on resume instead of repointing the existing one); only
 * the first occurrence should resume — the rest are stale copies that would each
 * `--resume` and thrash one shared session log, so callers archive them. Tabs
 * with no captured id are never flagged; they reattach through the cwd
 * `--continue` fallback, which is guarded separately.
 * @param sessionTabs - The currently open tabs, in strip order.
 * @returns Chat-tab ids of the duplicate terminal tabs to archive.
 */
export function findDuplicateTerminalTabIds(
	sessionTabs: SessionTabModel[],
): string[] {
	const seenSessionIds = new Set<string>();
	const duplicateIds: string[] = [];
	for (const session of sessionTabs) {
		if (!isLiveTerminalTab(session) || !session.agentSessionId) {
			continue;
		}
		if (seenSessionIds.has(session.agentSessionId)) {
			duplicateIds.push(session.id);
		} else {
			seenSessionIds.add(session.agentSessionId);
		}
	}
	return duplicateIds;
}

/**
 * Reports whether a live PTY-backed terminal tab of the given harness is already
 * open. A cwd `--continue` reattaches the harness's most recent conversation, so
 * restoring one without a captured id while another same-harness tab runs could
 * point both at one shared session log. Callers spawn fresh instead when true.
 * @param sessionTabs - The currently open tabs.
 * @param harnessId - The harness id to look for a live tab of.
 * @returns True when a live terminal tab of that harness is open.
 */
function hasLiveHarnessTab(
	sessionTabs: SessionTabModel[],
	harnessId: string,
): boolean {
	return sessionTabs.some(
		(session) => isLiveTerminalTab(session) && session.harnessId === harnessId,
	);
}

/**
 * Respawns the harness for a restored terminal (harness) tab, reattaching the
 * exact conversation via its persisted native session id and repointing the tab.
 * If that conversation is already open, focuses it and drops the duplicate; if
 * no session id was captured, reattaches the harness's most recent cwd
 * conversation via `--continue` (spawning fresh only when a same-harness tab is
 * already live, to avoid corrupting a shared log); if the harness or API is
 * unavailable, selects the tab as-is without a resume.
 * @param tab - The restored terminal tab wire row.
 * @param deps - The owning hook's collaborators.
 */
export function resumeRestoredTerminalTab(
	tab: ChatTabWire,
	deps: RestoreTerminalTabDeps,
): void {
	const { invalidate, selectTab, sessionTabs } = deps;
	const harnessId = metadataText(tab.metadata.harnessId);
	const agentSessionId = metadataText(tab.metadata.agentSessionId);

	const alreadyOpen = findOpenConversation(sessionTabs, agentSessionId, tab.id);
	if (alreadyOpen) {
		void deps.closeTab(tab.id);
		invalidate();
		selectTab(alreadyOpen.id);
		return;
	}

	const api = window.ensemblr;
	if (!api || !harnessId) {
		invalidate();
		selectTab(tab.id);
		return;
	}

	// Claim the tab so the post-restart auto-resume effect does not also respawn
	// it with the cwd-scoped "most recent" resume command.
	deps.claimTab(tab.id);
	// With a captured session id we reattach that exact conversation via `--resume`,
	// which never collides on a shared log. Without one we fall back to the cwd
	// `--continue` that reattaches the harness's most recent conversation — unless a
	// same-harness tab is already live, where two `--continue` processes could
	// corrupt one shared log, so we spawn fresh instead.
	const cwdContinue =
		!agentSessionId && !hasLiveHarnessTab(sessionTabs, harnessId);
	const fresh = !agentSessionId && !cwdContinue;
	void api
		.resumeAgentHarness({
			chatTabId: tab.id,
			fresh,
			harnessId,
			sessionId: agentSessionId,
			workspaceId: deps.workspaceId,
		})
		.then((resumeResult) => {
			invalidate();
			if (resumeResult.session) {
				selectTab(tab.id);
				return;
			}
			deps.releaseTab(tab.id);
			const message = resumeResult.diagnostics.find(
				(diagnostic) => diagnostic.severity === 'error',
			)?.message;
			toast.error('Could not restore agent', {
				description: message ?? 'The harness could not be resumed.',
			});
		});
}
