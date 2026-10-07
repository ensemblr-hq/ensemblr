import { lstat } from 'node:fs/promises';
import path from 'node:path';

import type { ContinueWorkspaceBranchDiagnostic } from '../../shared/ipc/contracts/workspace';
import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import { firstLine } from './first-line.ts';
import { resolveFreshForkRef } from './git-ops.ts';

/** Commits made after the merge, replayed onto the fresh base in order. */
export interface FollowUpRange {
	from: string;
	to: string;
}

/**
 * Where a continued workspace's successor branch forks, decided before anything
 * is checked out so a refusal leaves the worktree untouched.
 */
export type ContinuationPlan =
	| {
			baseCommit: string;
			kind: 'fresh-base';
			replay: FollowUpRange | null;
			warnings: ContinueWorkspaceBranchDiagnostic[];
	  }
	| { kind: 'keep-head'; warnings: ContinueWorkspaceBranchDiagnostic[] }
	| { diagnostic: ContinueWorkspaceBranchDiagnostic; kind: 'blocked' };

/** Git commands bound to one worktree, the way the continue flow runs them. */
export interface WorktreeGit {
	cwd: string;
	run: (
		args: readonly string[],
		timeoutMs?: number,
	) => Promise<LocalCommandResult>;
	succeeds: (args: readonly string[]) => Promise<boolean>;
	value: (args: readonly string[]) => Promise<string | null>;
}

/** Inputs to {@link planContinuation}. */
export interface ContinuationPlanRequest {
	baseBranch: string | null;
	git: WorktreeGit;
	localCommandService: LocalCommandService;
	mergedHeadCommit: string | null;
	repositoryPath: string;
}

const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_LISTED_BLOCKING_FILES = 5;

/**
 * Accepts a hex commit id only, so a cached value that opens with `-` is never
 * read as a git option. Sized for both sha1 and sha256 repositories.
 */
const COMMIT_OID_PATTERN = /^[0-9a-f]{7,64}$/i;

/**
 * Binds git to one worktree with the continue flow's timeout and output cap.
 * @param localCommandService - Runs the git binary.
 * @param cwd - Worktree every command runs in.
 * @returns The bound {@link WorktreeGit}.
 */
export function createWorktreeGit(
	localCommandService: LocalCommandService,
	cwd: string,
): WorktreeGit {
	/**
	 * Runs a git command inside the worktree.
	 * @param args - Arguments passed to `git`.
	 * @param timeoutMs - How long the command may run.
	 * @returns The command result.
	 */
	const run = (args: readonly string[], timeoutMs = GIT_TIMEOUT_MS) =>
		localCommandService.run({
			args: [...args],
			command: 'git',
			cwd,
			maxOutputBytes: GIT_MAX_OUTPUT_BYTES,
			timeoutMs,
		});

	return {
		cwd,
		run,
		/**
		 * Reports whether a git command exited zero.
		 * @param args - Arguments passed to `git`.
		 * @returns True on success.
		 */
		succeeds: async (args) => (await run(args)).status === 'success',
		/**
		 * Reads a git value, `null` when the command fails or prints nothing.
		 * @param args - Arguments passed to `git`.
		 * @returns The trimmed output, or `null`.
		 */
		value: async (args) => {
			const result = await run(args);
			return result.status === 'success' ? result.stdout.trim() || null : null;
		},
	};
}

/**
 * Decides where a workspace whose pull request merged should fork its successor
 * branch, so the review panel opens on the latest base instead of re-listing
 * work that is already upstream.
 *
 * The base is fetched first. The pull request's merged head, read from the
 * cached PR snapshot, marks where the merged work ends: once that work is on
 * the base — by merge, rebase, or squash — the successor forks from the base,
 * and any commits made after the merged head are replayed on top. Without a
 * merged head the base is used only when HEAD adds nothing to it. Anything else
 * falls back to forking from HEAD with a warning. Uncommitted work the move
 * cannot carry blocks it rather than conflict.
 * @param request - Base branch, merged head, and git dependencies.
 * @returns The plan for the successor branch.
 */
export async function planContinuation(
	request: ContinuationPlanRequest,
): Promise<ContinuationPlan> {
	const baseBranch = request.baseBranch?.trim();
	const headCommit = await request.git.value(['rev-parse', '--verify', 'HEAD']);
	if (!baseBranch || !headCommit) {
		return { kind: 'keep-head', warnings: [] };
	}

	const { baseCommit, warnings } = await refreshBase({
		...request,
		baseBranch,
	});
	if (!baseCommit) {
		return keepHead(
			`Could not resolve "${baseBranch}", so the new branch forked from the previous one and still contains its commits.`,
			warnings,
		);
	}

	const replay = await resolveReplay({ ...request, baseCommit, headCommit });
	if (!replay) {
		return keepHead(
			`This branch holds commits that "${baseBranch}" does not, so the new branch kept them and its diff will include already-merged work.`,
			warnings,
		);
	}

	const localChanges = await checkLocalChanges({
		baseBranch,
		baseCommit,
		git: request.git,
		replaying: replay.range !== null,
	});
	if (localChanges.kind === 'unchecked') {
		return keepHead(
			`Could not list the files "${baseBranch}" adds, so the new branch forked from the previous one rather than risk overwriting ignored local files.`,
			warnings,
		);
	}
	if (localChanges.kind === 'blocked') {
		return { diagnostic: localChanges.diagnostic, kind: 'blocked' };
	}

	return { baseCommit, kind: 'fresh-base', replay: replay.range, warnings };
}

/**
 * Fetches the base and pins it to a commit. A local base that has diverged
 * from its upstream yields the upstream, since that is where the pull request
 * merged; a fetch that fails falls back to the cached ref with a warning.
 * @param request - Base branch and git dependencies.
 * @returns The base commit, or `null` when it cannot be resolved, plus warnings.
 */
async function refreshBase({
	baseBranch,
	git,
	localCommandService,
	repositoryPath,
}: ContinuationPlanRequest & { baseBranch: string }): Promise<{
	baseCommit: string | null;
	warnings: ContinueWorkspaceBranchDiagnostic[];
}> {
	const fresh = await resolveFreshForkRef({
		baseBranch,
		localCommandService,
		repositoryPath,
	});
	const forkRef = fresh.status === 'diverged' ? fresh.upstreamRef : fresh.ref;
	const baseCommit = await git.value([
		'rev-parse',
		'--verify',
		'--quiet',
		`${forkRef}^{commit}`,
	]);
	const warnings: ContinueWorkspaceBranchDiagnostic[] =
		fresh.status === 'offline'
			? [
					{
						code: 'base-refresh-failed',
						message: `Could not refresh "${fresh.upstreamRef}", so the new branch forked from cached "${baseBranch}" and may miss the latest remote commits.`,
						severity: 'warning',
					},
				]
			: [];
	return { baseCommit, warnings };
}

/**
 * Works out whether HEAD's committed work is already on the base, and which
 * commits — those after the pull request's merged head — still need replaying.
 * @param request - Base and HEAD commits, the merged head, and git.
 * @returns The range to replay (`null` for none), or `null` when HEAD holds
 * work the base lacks and no merged head explains it.
 */
async function resolveReplay({
	baseCommit,
	git,
	headCommit,
	mergedHeadCommit,
}: {
	baseCommit: string;
	git: WorktreeGit;
	headCommit: string;
	mergedHeadCommit: string | null;
}): Promise<{ range: FollowUpRange | null } | null> {
	const mergedHead = await resolveMergedHead(git, mergedHeadCommit, baseCommit);
	if (mergedHead) {
		if (await isAncestor(git, headCommit, mergedHead)) {
			return { range: null };
		}
		if (await isAncestor(git, mergedHead, headCommit)) {
			return { range: { from: mergedHead, to: headCommit } };
		}
	}
	return (await addsNothingTo(git, baseCommit, headCommit))
		? { range: null }
		: null;
}

/**
 * Resolves the merged pull request's head locally, keeping it only when its
 * work already landed on the base.
 * @param git - Worktree git.
 * @param mergedHeadCommit - Head commit from the cached PR snapshot.
 * @param baseCommit - The refreshed base.
 * @returns The merged head commit, or `null` when it cannot be relied on.
 */
async function resolveMergedHead(
	git: WorktreeGit,
	mergedHeadCommit: string | null,
	baseCommit: string,
): Promise<string | null> {
	if (!mergedHeadCommit || !COMMIT_OID_PATTERN.test(mergedHeadCommit)) {
		return null;
	}
	const mergedHead = await git.value([
		'rev-parse',
		'--verify',
		'--quiet',
		`${mergedHeadCommit}^{commit}`,
	]);
	return mergedHead && (await isMergedInto(git, baseCommit, mergedHead))
		? mergedHead
		: null;
}

/**
 * Whether HEAD carries nothing the base lacks: it is an ancestor of the base,
 * or its tree already equals the base's. Deliberately stricter than
 * {@link isMergedInto}, which reads a commit that undoes part of the merged
 * work as already on the base and would drop it.
 * @param git - Worktree git.
 * @param baseCommit - The refreshed base.
 * @param headCommit - The worktree's HEAD.
 * @returns True when forking from the base loses nothing.
 */
async function addsNothingTo(
	git: WorktreeGit,
	baseCommit: string,
	headCommit: string,
): Promise<boolean> {
	return (
		(await isAncestor(git, headCommit, baseCommit)) ||
		(await git.succeeds(['diff', '--quiet', baseCommit, headCommit]))
	);
}

/**
 * Whether merging `commit` into `baseCommit` would change nothing, i.e. the
 * changes it made since the fork point already landed on the base by merge,
 * rebase, or squash. `git merge-tree --write-tree` needs git 2.38; on an older
 * git only the ancestry check answers, and a squash merge reads as not merged.
 * @param git - Worktree git.
 * @param baseCommit - Commit the work should already be on.
 * @param commit - Commit whose work is checked.
 * @returns True when the base already holds all of it.
 */
async function isMergedInto(
	git: WorktreeGit,
	baseCommit: string,
	commit: string,
): Promise<boolean> {
	if (await isAncestor(git, commit, baseCommit)) {
		return true;
	}
	const merged = await git.run([
		'merge-tree',
		'--write-tree',
		'--no-messages',
		baseCommit,
		commit,
	]);
	if (merged.status !== 'success') {
		return false;
	}
	const baseTree = await git.value(['rev-parse', `${baseCommit}^{tree}`]);
	return baseTree !== null && firstLine(merged.stdout) === baseTree;
}

/**
 * Whether `ancestor` is reachable from `descendant`, counting a commit as its
 * own ancestor.
 * @param git - Worktree git.
 * @param ancestor - The candidate ancestor.
 * @param descendant - The candidate descendant.
 * @returns True when `ancestor` is in `descendant`'s history.
 */
function isAncestor(
	git: WorktreeGit,
	ancestor: string,
	descendant: string,
): Promise<boolean> {
	return git.succeeds(['merge-base', '--is-ancestor', ancestor, descendant]);
}

/** What the local-change check concluded about moving onto the base. */
type LocalChangeCheck =
	| { diagnostic: ContinueWorkspaceBranchDiagnostic; kind: 'blocked' }
	| { kind: 'clear' }
	| { kind: 'unchecked' };

/**
 * Checks for uncommitted work the move onto the base cannot carry. A local
 * file the switch would rewrite blocks it; so does anything staged when
 * follow-up commits need replaying, because `git cherry-pick` refuses to run
 * while the index differs from HEAD. When the base's added files cannot be
 * listed the check is `unchecked`, since git's own checkout would not protect
 * an ignored file there. The messages name files only — the renderer's
 * headline carries what to do about them.
 * @param options - Base, whether a replay follows, and git.
 * @returns Whether the move is clear, blocked, or could not be checked.
 */
async function checkLocalChanges({
	baseBranch,
	baseCommit,
	git,
	replaying,
}: {
	baseBranch: string;
	baseCommit: string;
	git: WorktreeGit;
	replaying: boolean;
}): Promise<LocalChangeCheck> {
	const shadowed = await listShadowedLocalFiles(git, baseCommit);
	if (!shadowed) {
		return { kind: 'unchecked' };
	}
	const rewritten = [
		...new Set([
			...(await listRewrittenTrackedChanges(git, baseCommit)),
			...shadowed,
		]),
	];
	if (rewritten.length > 0) {
		return blockedBy(
			`Uncommitted changes to ${describeFiles(rewritten)} would be overwritten by newer commits on "${baseBranch}".`,
			rewritten,
		);
	}
	const staged = replaying
		? nulSeparated(
				await git.run([
					'diff',
					'--cached',
					'--name-only',
					'--no-renames',
					'-z',
					'HEAD',
				]),
			)
		: [];
	return staged.length > 0
		? blockedBy(
				`Staged changes to ${describeFiles(staged)} stop the commits made after the merge from being replayed onto "${baseBranch}".`,
				staged,
			)
		: { kind: 'clear' };
}

/**
 * Lists tracked files with uncommitted edits — staged, unstaged, or deleted —
 * that differ between HEAD and `baseCommit`, which git refuses to switch over.
 * Rename detection is off so both sides of a staged rename are checked.
 * @param git - Worktree git.
 * @param baseCommit - Commit the successor will fork from.
 * @returns The colliding paths.
 */
async function listRewrittenTrackedChanges(
	git: WorktreeGit,
	baseCommit: string,
): Promise<string[]> {
	const edited = nulSeparated(
		await git.run(['diff', '--name-only', '--no-renames', '-z', 'HEAD']),
	);
	if (edited.length === 0) {
		return [];
	}
	return nulSeparated(
		await git.run([
			'--literal-pathspecs',
			'diff',
			'--name-only',
			'--no-renames',
			'-z',
			'HEAD',
			baseCommit,
			'--',
			...edited,
		]),
	);
}

/**
 * Lists local files HEAD does not track that sit where `baseCommit` adds one.
 * Git refuses to overwrite an untracked file there but silently replaces an
 * ignored one, so the disk is checked directly rather than asking git which
 * files it considers expendable.
 * @param git - Worktree git.
 * @param baseCommit - Commit the successor will fork from.
 * @returns The shadowed paths, or `null` when git could not list the base's
 * added files in full (a failure, a timeout, or output past the cap).
 */
async function listShadowedLocalFiles(
	git: WorktreeGit,
	baseCommit: string,
): Promise<string[] | null> {
	const listing = await git.run([
		'diff',
		'--name-only',
		'--no-renames',
		'--diff-filter=A',
		'-z',
		'HEAD',
		baseCommit,
	]);
	if (listing.status !== 'success' || listing.stdoutTruncated) {
		return null;
	}
	const added = nulSeparated(listing);
	const present = await Promise.all(
		added.map(async (file) =>
			(await existsOnDisk(path.join(git.cwd, file))) ? file : null,
		),
	);
	return present.filter((file): file is string => file !== null);
}

/**
 * Whether anything — file, directory, or link — exists at `target`.
 * @param target - Absolute path to probe.
 * @returns True when the path exists.
 */
async function existsOnDisk(target: string): Promise<boolean> {
	try {
		await lstat(target);
		return true;
	} catch {
		return false;
	}
}

/**
 * Wraps a refusal in the check result that blocks the continue, carrying the
 * paths as data so the renderer can name them in the user's language.
 * @param message - Support-bundle English naming the files and why.
 * @param paths - Every blocking path.
 * @returns The blocked check result.
 */
function blockedBy(
	message: string,
	paths: readonly string[],
): LocalChangeCheck {
	return {
		diagnostic: {
			code: 'local-changes-block-sync',
			message,
			paths: [...paths],
			severity: 'error',
		},
		kind: 'blocked',
	};
}

/**
 * Splits `-z` output into paths, treating a failed command as listing nothing.
 * @param result - A git command run with `-z`.
 * @returns The listed paths.
 */
function nulSeparated(result: LocalCommandResult): string[] {
	return result.status === 'success'
		? result.stdout.split('\0').filter((file) => file.length > 0)
		: [];
}

/**
 * Names the first few blocking files and counts the rest.
 * @param files - Blocking paths.
 * @returns A short quoted list for the diagnostic message.
 */
function describeFiles(files: readonly string[]): string {
	const listed = files
		.slice(0, MAX_LISTED_BLOCKING_FILES)
		.map((file) => `"${file}"`)
		.join(', ');
	const hidden = files.length - MAX_LISTED_BLOCKING_FILES;
	return hidden > 0 ? `${listed} and ${hidden} more` : listed;
}

/**
 * Builds the fallback plan that forks from HEAD, leading with why it did, since
 * the first warning is the one the toast shows.
 * @param reason - Why the base could not be used.
 * @param warnings - Warnings already collected.
 * @returns A keep-head plan.
 */
function keepHead(
	reason: string,
	warnings: readonly ContinueWorkspaceBranchDiagnostic[],
): ContinuationPlan {
	return {
		kind: 'keep-head',
		warnings: [
			{ code: 'base-branch-unsynced', message: reason, severity: 'warning' },
			...warnings,
		],
	};
}
