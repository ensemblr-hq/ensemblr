/**
 * Trial merge of a base branch into the workspace branch, used to name the files
 * that will not merge. Kept out of the status service because it answers a
 * different question — what *would* happen — and needs none of that module's
 * diff plumbing.
 */

import type { GetWorkspaceMergeConflictsResult } from '../../shared/ipc/contracts/workspace-git';
import type { LocalCommandResult } from '../commands/local-command';

import {
	classifyGitFailure,
	gitFailureMessage,
} from './workspace-git-failures.ts';
import { parseMergeTreeConflicts } from './workspace-git-parsers.ts';

/** Remote whose tracking branches a pull request merges against. */
const ORIGIN_PREFIX = 'origin/';
/** `git merge-tree` exits 1 for a conflicting merge; anything higher is an error. */
const MERGE_TREE_CONFLICT_EXIT_CODE = 1;
/**
 * Marks the end of git's own flags. The request schema rejects a ref starting
 * with `-`, but stripping `origin/` can expose one behind the prefix, and git
 * parses options anywhere on the line — `origin/--upload-pack=…` would otherwise
 * reach `git fetch` as a flag.
 */
const END_OF_OPTIONS = '--end-of-options';

/** Runs a git subcommand in the workspace, supplied by the owning service. */
type RunGit = (
	cwd: string,
	args: readonly string[],
) => Promise<LocalCommandResult>;

/**
 * Paths that would conflict merging `baseRef` into HEAD. `git merge-tree
 * --write-tree` runs the merge entirely in the object database: it writes no
 * ref, never touches the working tree, and is safe to run beside uncommitted
 * edits or an unrelated in-progress merge.
 *
 * @param runGit - Runs a git subcommand in the workspace.
 * @param cwd - Absolute workspace directory, already validated.
 * @param baseRef - Base branch to merge from, with or without an `origin/` prefix.
 * @returns The conflicting paths, or a typed failure when the trial could not run.
 */
export async function readMergeConflicts(
	runGit: RunGit,
	cwd: string,
	baseRef: string,
): Promise<GetWorkspaceMergeConflictsResult> {
	const bareRef = baseRef.startsWith(ORIGIN_PREFIX)
		? baseRef.slice(ORIGIN_PREFIX.length)
		: baseRef;
	// The trial merge is only as current as the local base tip, and conflicts
	// arrive when the base moves — so refresh it first, tolerating failure so an
	// offline probe still answers against whatever is already fetched.
	await runGit(cwd, ['fetch', '--quiet', 'origin', END_OF_OPTIONS, bareRef]);
	const base = await resolveBaseRevision(runGit, cwd, bareRef);
	if (!base) {
		return {
			error: {
				code: 'command-failed',
				message: `Could not resolve base branch "${baseRef}".`,
			},
			paths: [],
		};
	}

	const result = await runGit(cwd, [
		'merge-tree',
		'--write-tree',
		'--name-only',
		'-z',
		END_OF_OPTIONS,
		base,
		'HEAD',
	]);
	if (result.status === 'success') {
		return { paths: [] };
	}
	if (result.exitCode === MERGE_TREE_CONFLICT_EXIT_CODE) {
		return { paths: parseMergeTreeConflicts(result.stdout) };
	}
	return {
		error: {
			code: classifyGitFailure(result.stderr),
			message: gitFailureMessage(result, 'git merge-tree failed in workspace.'),
		},
		paths: [],
	};
}

/**
 * The revision to merge from: the remote-tracking branch when it exists, since
 * that is what the pull request would actually merge, falling back to a local
 * branch of the same name for repositories with no matching remote.
 *
 * @param runGit - Runs a git subcommand in the workspace.
 * @param cwd - Absolute workspace directory, already validated.
 * @param bareRef - Branch name with any `origin/` prefix already stripped.
 * @returns The resolvable revision name, or null when neither exists.
 */
async function resolveBaseRevision(
	runGit: RunGit,
	cwd: string,
	bareRef: string,
): Promise<string | null> {
	const remoteRef = `${ORIGIN_PREFIX}${bareRef}`;
	const remote = await runGit(cwd, [
		'rev-parse',
		'--verify',
		'--quiet',
		END_OF_OPTIONS,
		remoteRef,
	]);
	if (remote.status === 'success' && remote.stdout.trim()) {
		return remoteRef;
	}
	const local = await runGit(cwd, [
		'rev-parse',
		'--verify',
		'--quiet',
		END_OF_OPTIONS,
		bareRef,
	]);
	return local.status === 'success' && local.stdout.trim() ? bareRef : null;
}
