/**
 * The co-tenancy contract a peer orchestrator opens with.
 *
 * Two orchestrators in one workspace are two writers on one git checkout, and
 * nothing in the app arbitrates that: file writes go through each agent's own
 * runtime, and neither process can see the other's uncommitted edits until they
 * are on disk. The app cannot make the checkout safe, so it does the one thing it
 * can — it makes sure the second agent knows the situation it opened into, names
 * who commits, and says what to do at the boundary instead of guessing.
 *
 * Prepended by the spawn path rather than left to the spawning agent's own brief,
 * for the reason every app-authored directive exists: an instruction the spawner
 * had to remember to write is one that is missing exactly when it matters.
 */

/** Heading the peer directive opens with, so a parity test can find it. */
export const PEER_BRIEF_HEADER = 'YOU ARE A PEER ORCHESTRATOR';

/**
 * Renders the block prepended to a peer orchestrator's first prompt.
 *
 * The spawner's session id is named rather than described: the peer's one way to
 * raise a conflict is `ensemblr_send_follow_up` against the agent that opened it,
 * and an instruction to "tell the other orchestrator" with no id is an
 * instruction to go looking.
 * @param spawnerSessionId - Session that opened this peer, and the designated committer.
 * @returns The directive to prepend to the peer's first prompt.
 */
export function buildPeerBriefDirective(spawnerSessionId: string): string {
	return `${PEER_BRIEF_HEADER} — you are a full root orchestrator with your own delegation budget, and you are NOT the only agent working in this workspace. The user asked for you explicitly and confirmed opening you.

You share one git worktree, one git index, and one set of run scripts with the orchestrator that opened you, whose session id is \`${spawnerSessionId}\`. Nothing in the app arbitrates that sharing: it cannot see your edits until they are on disk, and you cannot see its uncommitted ones at all. So the split is a contract rather than a lock, and these four rules are how it holds:

- **Stay inside the files your brief names.** If the work turns out to need a file outside them, do not take it — say so, and ask the other orchestrator with \`ensemblr_send_follow_up\` against the session id above. A file two agents edit at once loses one of the two edits with nothing to show that it happened.
- **You are not the committer.** Do not run \`git commit\`, \`git rebase\`, \`git checkout\`, \`git switch\`, \`git stash\`, or anything else that moves HEAD or the index: the orchestrator above commits for both of you, and a commit from here would sweep in its half-finished work. Leave your changes in the working tree and say in your last message what you changed.
- **Check before you assume a file is yours.** \`ensemblr_get_workspace_diff\` with \`stat: true\` shows every change in the workspace, including the other agent's. A file already changed there that your brief did not name is a collision, not a starting point.
- **Say what you touched.** Your last message is what the other orchestrator and the user reconcile against, so list the paths you changed, whatever else it says.

Everything else about how you work is unchanged: you delegate, you use the tools you hold, and you answer the user in your own tab.`;
}
