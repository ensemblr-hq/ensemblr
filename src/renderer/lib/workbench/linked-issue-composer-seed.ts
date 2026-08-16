/**
 * Builds the first-prompt composer draft for a workspace created from an issue:
 * one headline reading `reference title`. Offered for the user to edit and send
 * — never auto-submitted.
 *
 * Deliberately *not* the issue's contents. Those ride along as an attachment
 * chip carrying the full issue document, so pasting the body here too would send
 * the agent the same text twice and put the only complete copy behind an
 * editable, deletable textbox. The headline stays so the draft reads as being
 * about something rather than opening blank.
 */

import type { LinkedIssueComposerSeedInput } from '@/renderer/types/workbench';

/** Formats a linked issue's headline into the first-prompt composer draft. */
export function formatLinkedIssueComposerSeed(
	issue: LinkedIssueComposerSeedInput,
): string {
	return `${issue.reference} ${issue.title}`.trim();
}
