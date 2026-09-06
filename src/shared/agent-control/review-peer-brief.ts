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
 * The first of those is why the reviewer is a peer rather than a child
 * ([ADR 0063](../../../docs/adr/0063-open-an-agent-requested-review-as-a-peer-again.md)).
 * A sub-agent cannot delegate on any axis, so a reviewer shaped as one reads a
 * fifty-file diff in a single window or not at all — and the review is the one
 * step of the unattended loop whose whole job is a second, wider reading.
 *
 * Which delegation ops the reviewer holds is not knowable from here, which is
 * why the block names none. A peer records no parent and carries no sub-agent
 * marker, so `resolveDelegation` falls through to the user's own
 * `claudeSubagentMode` for a review opened on Claude Code — and under `native`
 * the Ensemblr spawn ops are withheld by `NATIVE_DELEGATION_WITHHELD_OPS` in
 * favour of the runtime's own sub-agent tool. That reviewer still has a
 * delegation budget; it reaches it through a different mechanism. So the
 * paragraph states the budget and leaves the mechanism to whichever tool list
 * the reader actually holds. `ensemblr_get_workspace_diff` and
 * `ensemblr_add_diff_comments` stay named, because neither is on that list.
 *
 * The same withholding is why the escape hatch is the report rather than an op.
 * `ensemblr_notify_orchestrator` is refused to a root and
 * `ensemblr_send_follow_up` may be absent, so a reviewer that cannot review has
 * no way to *initiate* contact under `native` — what it always has is the final
 * message the orchestrator is already blocked on.
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
 * The opening orchestrator's session id is named rather than described, for a
 * narrower reason than the peer brief names its spawner: it identifies who is
 * blocked on the report and who owns the commit, rather than offering a route
 * back. A reviewer holding `ensemblr_send_follow_up` can steer that session with
 * it; one under `native` delegation cannot, so the block promises only the
 * channel every reviewer has.
 * @param spawnerSessionId - Session that opened this review, and the committer.
 * @returns The directive to prepend to the review conversation's first prompt.
 */
export function buildReviewPeerDirective(spawnerSessionId: string): string {
	return `${REVIEW_PEER_BRIEF_HEADER} — another orchestrator working in this workspace asked the app for a review of its change, and this conversation is that review. The guidelines below are the same ones the user's own Review button runs.

You are a full root orchestrator with a delegation budget of your own, not a sub-agent: when the change is wide enough that one reader would miss things, fan readers out over it through whichever sub-agent mechanism your tool list actually carries — this app's spawn tools, or your own runtime's. You hold one of the two, never both. \`ensemblr_get_workspace_diff\` is how you scope that split — call it with \`stat: true\` first for the file list, then read the diff whole, or hand one reader a slice of it at a time with \`filePath\`.

- **Review first, and report.** Your first turn is a review, not a repair. Work through the guidelines below and answer with your findings, whatever else you do.
- **Expect to be asked to fix them.** The orchestrator that opened you — session id \`${spawnerSessionId}\` — is waiting on your report and will follow up asking you to fix what you found. That follow-up is in scope: fix it here, in this conversation, delegating the work if it is wide. Fix the finding rather than restating it, and say plainly which ones you did not fix and why.
- **You are not the committer.** Do not run \`git commit\`, \`git rebase\`, \`git checkout\`, \`git switch\`, \`git stash\`, or anything else that moves HEAD or the index, and never open or merge a pull request. The orchestrator above commits for both of you and owns the pull request. Leave your changes in the working tree.
- **You share this worktree.** It holds off writing while you work, and you should assume nothing else is editing the files you are. \`ensemblr_add_diff_comments\` puts a finding on the line it belongs to.
- **Say what you touched, and say it in your report.** Your last message is the whole of what the orchestrator reads, so it carries your findings, the paths you changed, and anything you decided on your own. It is also the one channel back you are guaranteed: the session above is blocked on that message, and depending on which delegation mechanism you hold you may have no op that reaches it sooner. So when you cannot review at all — the diff is empty, the brief contradicts the change — put that at the TOP of the report and end the turn, rather than waiting out a turn you cannot finish.`;
}
