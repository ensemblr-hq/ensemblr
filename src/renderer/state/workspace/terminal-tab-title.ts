/**
 * Live-title resolution for terminal (harness) tabs. Harnesses disagree about
 * where their conversation title lives — some emit it as an OSC window title,
 * others only write it to their session log — so this owns picking the right
 * source and returning both the capped and untruncated forms together.
 */

import { stripHarnessTitleDecoration } from '@/renderer/lib/terminal/harness-title';
import { harnessConversationTitleSource } from '@/shared/agents/harness-registry';

/**
 * A live terminal title in both the form shown on the tab and the untruncated
 * form shown in its tooltip. Main caps `agentTitle` for display and carries the
 * uncapped text alongside it as `agentFullTitle`.
 */
export type LiveTerminalTitle = {
	display: string;
	full: string;
};

/** The lifecycle-snapshot fields a live title can be derived from. */
export type LiveTerminalTitleSource = {
	agentFullTitle: string | null;
	agentTitle: string | null;
	title: string;
};

/**
 * Resolves the live label a terminal tab should show from a lifecycle snapshot.
 * Codex and Vibe do not put their conversation title in the OSC window title
 * (Codex uses the cwd, Vibe a static "Vibe"), so main reads it from the harness
 * session log and delivers it as `agentTitle`; for those harnesses prefer it and
 * ignore the OSC title. Every other harness titles from the OSC escape, stripping
 * the leading spinner glyph (which still drives the busy flag elsewhere). Returns
 * null when the title is empty or still just the harness label.
 * @param harnessId - The tab's harness id, used to pick the title source.
 * @param harnessLabel - The default harness label to treat as "no real title".
 * @param session - The lifecycle snapshot carrying the OSC and agent titles.
 * @returns The display and full label to adopt, or null to fall back to the harness label.
 */
export function resolveLiveTerminalTitle(
	harnessId: string,
	harnessLabel: string,
	session: LiveTerminalTitleSource,
): LiveTerminalTitle | null {
	const readsConversationLog = harnessConversationTitleSource(harnessId);
	const candidate = readsConversationLog
		? (session.agentTitle ?? '').trim()
		: stripHarnessTitleDecoration(session.title);
	if (!candidate || candidate === harnessLabel) {
		return null;
	}
	// Only the session-log harnesses carry a separate uncapped title; an OSC
	// title is whatever the harness chose to emit and is already its full form.
	const full = readsConversationLog
		? (session.agentFullTitle ?? '').trim() || candidate
		: candidate;
	return { display: candidate, full };
}

/**
 * Whether two resolved titles are interchangeable, so a lifecycle event that
 * re-derives the same title does not push a new state object and re-render the
 * whole tab strip.
 * @param a - The previously stored title, if any.
 * @param b - The freshly resolved title.
 * @returns True when both forms match.
 */
export function sameLiveTerminalTitle(
	a: LiveTerminalTitle | undefined,
	b: LiveTerminalTitle,
): boolean {
	return a?.display === b.display && a.full === b.full;
}
