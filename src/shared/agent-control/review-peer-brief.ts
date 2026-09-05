/**
 * The contract the Review conversation opens with when an agent started it
 * rather than the user clicking the Review button.
 *
 * A review opened from the button answers to the person reading its tab, so it
 * needs nothing but the review prompt. One opened by `startReview` answers to
 * the orchestrator that opened it and shares that orchestrator's worktree, so
 * three things have to be said before the review prompt: it is a root
 * orchestrator and may delegate, it is not the committer, and a follow-up asking
 * it to fix its own findings is expected rather than out of scope.
 *
 * Deliberately not {@link buildPeerBriefDirective}. That block is written for a
 * peer opened to split work — "stay inside the files your brief names", "the
 * user asked for you explicitly and confirmed opening you" — and both are false
 * here: a reviewer reads everything, and nobody confirmed anything.
 */

/** Heading the directive opens with, so a parity test can find it. */
export const REVIEW_PEER_BRIEF_HEADER = 'YOU ARE THIS WORKSPACE’S REVIEWER';

/**
 * Renders the block prepended to an agent-opened review conversation's first
 * prompt.
 *
 * The opening orchestrator's session id is named rather than described, for the
 * reason the peer brief names its spawner: the reviewer's one way to reach it is
 * `ensemblr_send_follow_up` against that id, and an instruction to "tell the
 * orchestrator" with no id is an instruction to go looking.
 * @param spawnerSessionId - Session that opened this review, and the committer.
 * @returns The directive to prepend to the review conversation's first prompt.
 */
export function buildReviewPeerDirective(spawnerSessionId: string): string {
	return `${REVIEW_PEER_BRIEF_HEADER} — another orchestrator working in this workspace asked the app for a review of its change, and this conversation is that review. The guidelines below are the same ones the user's own Review button runs.

You are a full root orchestrator with your own delegation budget, not a sub-agent: delegate freely with \`ensemblr_start_conversation\` when the change is wide enough that one reader would miss things, and gather the results with \`ensemblr_wait_for_agents\`.

- **Review first, and report.** Your first turn is a review, not a repair. Work through the guidelines below and answer with your findings, whatever else you do.
- **Expect to be asked to fix them.** The orchestrator that opened you — session id \`${spawnerSessionId}\` — is waiting on your report and will follow up asking you to fix what you found. That follow-up is in scope: fix it here, in this conversation, delegating the work if it is wide. Fix the finding rather than restating it, and say plainly which ones you did not fix and why.
- **You are not the committer.** Do not run \`git commit\`, \`git rebase\`, \`git checkout\`, \`git switch\`, \`git stash\`, or anything else that moves HEAD or the index, and never open or merge a pull request. The orchestrator above commits for both of you and owns the pull request. Leave your changes in the working tree.
- **You share this worktree.** It holds off writing while you work, and you should assume nothing else is editing the files you are. \`ensemblr_get_workspace_diff\` shows the change under review, and \`ensemblr_add_diff_comments\` puts a finding on the line it belongs to.
- **Say what you touched.** Your last message is the whole of what the orchestrator reads, so it carries your findings, the paths you changed, and anything you decided on your own.`;
}
