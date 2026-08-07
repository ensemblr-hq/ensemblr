/**
 * Renders the per-turn upkeep block appended to an agent's system prompt.
 *
 * The three naming tools are also described in the role playbooks, but a
 * playbook is static: a long skill invocation, or Plan Mode's instruction that
 * nothing else in context outranks it, reliably buries a standing "remember to
 * name your tab". This block is rebuilt from live state every turn, names only
 * what is still outstanding, and disappears entirely once nothing is — so it
 * stays legible without becoming noise.
 *
 * For the branch it is not just a reminder but the only instruction: the
 * `git.renameWorkspaceOnBranch` setting gates `ensemblr_set_branch_name`, and a
 * static playbook cannot see a setting, so the playbooks describe the tool and
 * defer to this block for whether to call it. An unconditional "name the branch"
 * in a playbook would order an opted-out user's agent to call a tool that
 * refuses it.
 *
 * It is rendered here, in the app, rather than in the shipped Pi extension. The
 * extension carries byte-identical copies of the playbooks because it cannot
 * import from `src/` at runtime, and a parity test polices them; a block built
 * from runtime state has no literal to compare, so the app ships the finished
 * string in the brief payload and the extension appends text it never authors.
 */

import type { SessionBriefNaming } from './contracts.ts';

/** Opening line of the upkeep block, and the marker tests assert on. */
export const SESSION_BRIEF_NUDGE_HEADER = 'ENSEMBLR SESSION UPKEEP';

/** Preamble framing the block as bookkeeping to fold into the turn silently. */
const NUDGE_PREAMBLE = `${SESSION_BRIEF_NUDGE_HEADER} — the app tracks this for you and raises only what is still outstanding. Fold these into this turn: no narration to the user, no asking permission. Each line disappears once its item is done.`;

/** Bullet asking the agent to replace the prompt-derived tab title. */
const TITLE_BULLET =
	'- Tab title: this tab is still carrying a title derived from the prompt rather than chosen. Call `ensemblr_set_name` with a short, specific title for what this conversation is actually about.';

/** Bullet asking the agent to record what the turn covered. */
const SUMMARY_BULLET =
	"- Session summary: the summary on file for this tab is older than the conversation. Call `ensemblr_set_summary` once the work is done but BEFORE you write your closing answer to the user — prose you follow with another tool call gets folded into the turn's collapsed activity row. Pass a short `title` and a markdown `summary` covering the decisions made, the files touched, and what is still open. It replaces the record the app keeps for this tab; it does NOT rename the tab.";

/**
 * Builds the bullet asking the agent to name the branch, and the workspace with
 * it while the workspace has no chosen title.
 * @param branch - The branch's current name and whether naming it also retitles the workspace.
 * @returns The branch upkeep bullet.
 */
function branchBullet(branch: SessionBriefNaming['branch']): string {
	const where = branch.current ? ` \`${branch.current}\`` : '';
	const scope = branch.namesWorkspace
		? `- Workspace & branch: this workspace still has its generated placeholder name and sits on the branch${where} it was cut with. Call \`ensemblr_set_branch_name\` once with a kebab-case slug naming the work (2-5 words, e.g. \`add-dark-mode\`) — it renames the workspace and the git branch together and keeps any \`prefix/\` segment.`
		: `- Branch: the user has titled this workspace, but its git branch${where} still carries the name it was cut with. Call \`ensemblr_set_branch_name\` once with a kebab-case slug naming the work (2-5 words, e.g. \`add-dark-mode\`) — it moves the branch, keeps any \`prefix/\` segment, and leaves the title the user chose alone.`;
	return `${scope} Do it now and only once; never reach for \`git branch -m\` instead, which renames the branch behind the app.`;
}

/**
 * Renders the upkeep block for a session's outstanding naming work.
 * @param naming - The upkeep the session still owes, from `getSessionBrief`.
 * @returns The block to append to the system prompt, or null when nothing is outstanding.
 */
export function buildSessionBriefNudge(
	naming: SessionBriefNaming,
): string | null {
	const bullets = [
		naming.titleNeeded ? TITLE_BULLET : null,
		naming.branch.eligible ? branchBullet(naming.branch) : null,
		naming.summaryStale ? SUMMARY_BULLET : null,
	].filter((bullet) => bullet !== null);
	if (bullets.length === 0) {
		return null;
	}
	return `${NUDGE_PREAMBLE}\n\n${bullets.join('\n')}`;
}
