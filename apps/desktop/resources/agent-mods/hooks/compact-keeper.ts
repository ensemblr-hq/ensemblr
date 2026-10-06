/**
 * compact-keeper: tells every compaction what an Ensemblr orchestrator cannot
 * work without afterwards. A summary that drops a child's `agentSessionId` or a
 * queued `jobId` leaves the agent unable to wait on, steer, or close the work it
 * already started, and it re-spawns or re-queues instead.
 */
import type { EngineInterface, On } from 'claude-code';

/** How long reading the current branch may take before compaction goes on without it. */
const BRANCH_PROBE_TIMEOUT_MS = 5_000;

/** What every compaction is told to carry over verbatim. */
export const KEEP_INSTRUCTIONS = `This session runs inside Ensemblr. The summary must carry these over verbatim, each id copied exactly, because the next turn cannot recover them from anywhere else:
- Every child conversation started with ensemblr_start_conversation: its agentSessionId, its chatTabId, its title, whether it is still running or settled, and the gist of its report if one came back.
- Every compute-queue job queued with ensemblr_run_queued: its jobId, the command, and its last known state (queued, running, finished with exit code, timed out).
- The workspace's git branch, and whether work on it is committed, pushed, or has a pull request.
- Every open diff-review comment id from ensemblr_get_diff_comments or ensemblr_add_diff_comments, which ones were fixed, and which are still open and why.
- Every decision made so far — by the user, or by you and stated to the user — with its reason, and every question still waiting on the user.`;

/**
 * Reads the branch the session's checkout is on.
 * @param $ - The engine interface.
 * @returns The branch name, or null when git cannot say.
 */
async function readBranch($: EngineInterface): Promise<string | null> {
	try {
		const probe = await $.process.run(['git', 'branch', '--show-current'], {
			timeoutMs: BRANCH_PROBE_TIMEOUT_MS,
		});
		const branch = probe.stdout.trim();
		return probe.exitCode === 0 && branch !== '' ? branch : null;
	} catch {
		return null;
	}
}

/**
 * Joins the person's or another plugin's instructions with Ensemblr's.
 * @param instructions - The instructions already set, if any.
 * @param branch - The current branch, if known.
 * @returns The instructions the summarizer is given.
 */
function composeInstructions(
	instructions: string | undefined,
	branch: string | null,
): string {
	const branchLine =
		branch === null ? null : `The workspace branch is currently \`${branch}\`.`;
	return [instructions?.trim() || null, KEEP_INSTRUCTIONS, branchLine]
		.filter((part) => part !== null)
		.join('\n\n');
}

/**
 * Registers compact-keeper's compaction hook.
 * @param on - The plugin's registrar.
 */
export function registerCompactKeeper(on: On): void {
	on('session.compact', async ($, e, next) =>
		next({
			...e,
			instructions: composeInstructions(e.instructions, await readBranch($)),
		}),
	);
}
