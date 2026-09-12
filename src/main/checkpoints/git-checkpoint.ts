import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { stripLaunchContextEnv } from '../environment/launch-env.ts';

const execFileAsync = promisify(execFile);

/** Largest stdout any checkpoint git step will buffer before the child is killed. */
const GIT_CHECKPOINT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * Deadline for one checkpoint git step. Capture runs on the agent's turn
 * boundary, so a git that wedges — a stuck `.git/index.lock`, a slow network
 * filesystem — must surface as a failed checkpoint rather than a turn that
 * never settles.
 */
const GIT_CHECKPOINT_TIMEOUT_MS = 60_000;

/**
 * Captures the full working-tree state of a git workspace (tracked changes AND
 * untracked files, `.gitignore` respected) into a commit reachable only from a
 * private ref. Uses a temporary index file so the user's real index, HEAD, and
 * branches are never touched (ADR 0012).
 *
 * The ref and its objects live in the repository's shared object store, not the
 * worktree's, because `refs/ensemblr/` is a common ref namespace. A checkpoint
 * is therefore readable from every workspace of the same repository — scoped to
 * the repository rather than the workspace — which is what makes the snapshots
 * cheap to deduplicate.
 */
interface CaptureWorkspaceCheckpointInput {
	cwd: string;
	message: string;
	/** Private ref under `refs/ensemblr/<namespace>/`, e.g. `refs/ensemblr/checkpoints/<ws>/<turn>`. */
	ref: string;
}

/** Identifiers produced by a workspace checkpoint capture: the commit, its tree, and the ref it was written to. */
interface CaptureWorkspaceCheckpointResult {
	commitHash: string;
	/** HEAD at capture time — the snapshot's parent — or null on an unborn branch. */
	parentHash: string | null;
	ref: string;
	treeHash: string;
}

/** Typed error thrown when a checkpoint git step fails, naming the step. */
export class GitCheckpointError extends Error {
	readonly step: string;

	constructor({ message, step }: { message: string; step: string }) {
		super(message);
		this.name = 'GitCheckpointError';
		this.step = step;
	}
}

/**
 * Every ref this module may write, across the namespaces that use it: agent
 * turn checkpoints under `refs/ensemblr/checkpoints/`, and the snapshot a
 * pruned archive is re-derived from under `refs/ensemblr/archived/`. Anything
 * outside `refs/ensemblr/<namespace>/` is refused, so a caller can never make
 * `update-ref` move a branch or a tag.
 */
const REF_PATTERN = /^refs\/ensemblr\/[\w.-]+\/[\w./-]+$/;

/**
 * Keeps an id inside the ref namespace even if a slug-like id sneaks in. Lives
 * beside {@link REF_PATTERN} so the sanitizer and the guard it has to satisfy
 * cannot drift apart.
 * @param segment - Raw id to place in a ref path.
 * @returns The segment with every character the pattern rejects replaced.
 */
export function sanitizeRefSegment(segment: string): string {
	return segment.replaceAll(/[^\w.-]/g, '-');
}

/** Fixed identity so capture never depends on the user's git config. */
const GIT_IDENTITY_ENV = {
	GIT_AUTHOR_EMAIL: 'checkpoints@ensemblr.local',
	GIT_AUTHOR_NAME: 'Ensemblr',
	GIT_COMMITTER_EMAIL: 'checkpoints@ensemblr.local',
	GIT_COMMITTER_NAME: 'Ensemblr',
};

/**
 * Capture the full working-tree state of a git workspace into a commit reachable
 * only from a private ref, using a temporary index so the user's real index,
 * HEAD, and branches are untouched (ADR 0012).
 * @param cwd - Workspace directory to capture
 * @param message - Commit message for the checkpoint commit
 * @param ref - Fully-qualified private ref to point at the new commit
 * @returns The captured commit, tree, and ref identifiers
 */
export async function captureWorkspaceCheckpoint({
	cwd,
	message,
	ref,
}: CaptureWorkspaceCheckpointInput): Promise<CaptureWorkspaceCheckpointResult> {
	if (!REF_PATTERN.test(ref)) {
		throw new GitCheckpointError({
			message: `Refusing to write outside the ensemblr ref namespace: ${ref}`,
			step: 'validate-ref',
		});
	}

	await runGit({ args: ['rev-parse', '--git-dir'], cwd, step: 'verify-repo' });

	return await withTemporaryIndex(async (indexEnv) => {
		const [treeHash, parentHash] = await Promise.all([
			writeWorkingTree({ cwd, indexEnv }),
			resolveHeadCommit(cwd),
		]);

		const commitArgs = ['commit-tree', treeHash, '-m', message];
		if (parentHash) {
			commitArgs.push('-p', parentHash);
		}
		const commitHash = await runGit({
			args: commitArgs,
			cwd,
			env: indexEnv,
			step: 'commit-tree',
		});

		await runGit({
			args: ['update-ref', ref, commitHash],
			cwd,
			step: 'update-ref',
		});

		return { commitHash, parentHash, ref, treeHash };
	});
}

/**
 * Run `body` against a throwaway git index file so the user's real index is
 * never touched, removing the temporary directory once it settles.
 * @param body - Receives the environment overlay pointing git at the temporary index
 * @returns Whatever `body` resolves to
 */
async function withTemporaryIndex<T>(
	body: (indexEnv: Record<string, string>) => Promise<T>,
): Promise<T> {
	const indexDirectory = await mkdtemp(
		path.join(tmpdir(), 'ensemblr-checkpoint-'),
	);
	try {
		return await body({
			...GIT_IDENTITY_ENV,
			GIT_INDEX_FILE: path.join(indexDirectory, 'index'),
		});
	} finally {
		await rm(indexDirectory, { force: true, recursive: true });
	}
}

/**
 * Stage the whole working tree into the temporary index and write it out as a
 * tree object. `add -A` includes untracked files and records deletions, while
 * ignored files stay out.
 * @param cwd - Workspace directory to stage
 * @param indexEnv - Environment overlay pointing git at the temporary index
 * @returns Hash of the written tree object
 */
async function writeWorkingTree({
	cwd,
	indexEnv,
}: {
	cwd: string;
	indexEnv: Record<string, string>;
}): Promise<string> {
	await runGit({
		args: ['add', '-A', '--', '.'],
		cwd,
		env: indexEnv,
		step: 'stage-working-tree',
	});
	return await runGit({
		args: ['write-tree'],
		cwd,
		env: indexEnv,
		step: 'write-tree',
	});
}

/**
 * Writes the current working-tree state (tracked + untracked, ignores
 * respected) into a tree object without touching refs, HEAD, or the real
 * index. Used as the "post-turn" side of a diff when no later checkpoint
 * exists yet.
 */
export async function snapshotWorkingTree(cwd: string): Promise<string> {
	return await withTemporaryIndex((indexEnv) =>
		writeWorkingTree({ cwd, indexEnv }),
	);
}

/** A single file's change within a git diff, with per-file line counts and status. */
interface GitDiffFile {
	additions: number | null;
	deletions: number | null;
	path: string;
	status: 'added' | 'deleted' | 'modified' | 'renamed';
}

/** A parsed git diff: the per-file change summary plus the full unified patch text. */
export interface GitDiffResult {
	files: readonly GitDiffFile[];
	patch: string;
}

/**
 * Diffs two tree-ish revisions (commit or tree hashes).
 *
 * One `git diff` carrying all three output families rather than three
 * invocations: `--raw` for the status letters, `--numstat` for the counts, and
 * `--patch` for the hunks. Git emits them in that order in a single stream, so
 * this is both one spawn instead of three and one buffer instead of three —
 * each pass buffers up to {@link GIT_CHECKPOINT_MAX_BUFFER_BYTES}, and a turn
 * that regenerated a lockfile used to make all three hold that much at once.
 */
export async function diffTrees({
	cwd,
	fromRev,
	toRev,
}: {
	cwd: string;
	fromRev: string;
	toRev: string;
}): Promise<GitDiffResult> {
	const combined = await runGit({
		args: ['diff', '-M', '--raw', '--numstat', '--patch', fromRev, toRev],
		cwd,
		step: 'diff-combined',
	});

	return parseCombinedDiff(combined);
}

/**
 * Splits the one combined `git diff` stream into its three sections and folds
 * them into a {@link GitDiffResult}.
 *
 * The sections are self-identifying, which is what makes one stream safe to
 * split: a `--raw` line opens with `:`, the patch opens with `diff --git`, and
 * a `--numstat` line is whatever sits between them.
 *
 * Status and counts are zipped by **position**, not by path. Git drives both
 * sections off the same diff queue, so entry *i* of each describes the same
 * file — and the paths do not always agree: for a rename `--raw` gives the
 * canonical new path while `--numstat` gives `old => new` (or the braced
 * `dir/{old => new}`) as one field. Matching on the path therefore missed every
 * rename and reported it as a plain modification, which is what this repo did
 * before the two calls became one.
 * @param combined - Stdout of `git diff -M --raw --numstat --patch`.
 * @returns The per-file entries and the patch text.
 */
export function parseCombinedDiff(combined: string): GitDiffResult {
	const statuses: GitDiffFile['status'][] = [];
	const paths: string[] = [];
	const counts: { additions: number | null; deletions: number | null }[] = [];
	const patchLines: string[] = [];
	let inPatch = false;

	for (const line of combined.split('\n')) {
		if (inPatch || line.startsWith('diff --git ')) {
			inPatch = true;
			patchLines.push(line);
			continue;
		}
		if (!line.trim()) {
			continue;
		}
		if (line.startsWith(':')) {
			const [meta = '', ...rawPaths] = line.split('\t');
			statuses.push(statusFromCode(meta.split(' ').at(-1) ?? ''));
			paths.push(rawPaths.at(-1) ?? '');
			continue;
		}

		const [added = '', deleted = ''] = line.split('\t');
		counts.push({
			additions: added === '-' ? null : Number.parseInt(added, 10),
			deletions: deleted === '-' ? null : Number.parseInt(deleted, 10),
		});
	}

	return {
		files: paths.map((filePath, index) => ({
			additions: counts[index]?.additions ?? null,
			deletions: counts[index]?.deletions ?? null,
			path: filePath,
			status: statuses[index] ?? 'modified',
		})),
		patch: patchLines.join('\n'),
	};
}

/**
 * Reverts the workspace's tracked file state to a checkpoint commit using
 * `git read-tree -u --reset`. Conservative by design (ADR 0012): files created
 * AFTER the checkpoint that were never tracked are left in place rather than
 * deleted, so unrelated user work cannot be destroyed.
 */
export async function restoreWorkspaceTo({
	commitHash,
	cwd,
}: {
	commitHash: string;
	cwd: string;
}): Promise<void> {
	await runGit({ args: ['rev-parse', '--git-dir'], cwd, step: 'verify-repo' });
	await runGit({
		args: ['read-tree', '-u', '--reset', commitHash],
		cwd,
		step: 'read-tree-restore',
	});
}

/**
 * Map a git status code letter to a diff file status.
 * @param code - Status code from the `--raw` section, e.g. `M`, `A`, `R100`
 * @returns The corresponding file status
 */
function statusFromCode(code: string): GitDiffFile['status'] {
	switch (code.charAt(0)) {
		case 'A':
			return 'added';
		case 'D':
			return 'deleted';
		case 'R':
			return 'renamed';
		default:
			return 'modified';
	}
}

/** Returns the HEAD commit hash, or `null` on an unborn branch / empty repo. */
async function resolveHeadCommit(cwd: string): Promise<string | null> {
	try {
		return await runGit({
			args: ['rev-parse', '--verify', '--quiet', 'HEAD'],
			cwd,
			step: 'resolve-head',
		});
	} catch {
		return null;
	}
}

/**
 * Runs Git without inherited app/repository context, then overlays only this
 * module's private identity/temp-index settings. Throws on command failure.
 * @param args - Git arguments to pass
 * @param cwd - Directory to run git in
 * @param env - Internal identity and temporary-index overrides, never caller environment
 * @param step - Label identifying this step for error reporting
 * @returns Trimmed stdout of the git command
 */
async function runGit({
	args,
	cwd,
	env,
	step,
}: {
	args: readonly string[];
	cwd: string;
	env?: Record<string, string>;
	step: string;
}): Promise<string> {
	try {
		const { stdout } = await execFileAsync('git', [...args], {
			cwd,
			env: { ...stripLaunchContextEnv(process.env), ...env },
			maxBuffer: GIT_CHECKPOINT_MAX_BUFFER_BYTES,
			timeout: GIT_CHECKPOINT_TIMEOUT_MS,
		});
		return stdout.trim();
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new GitCheckpointError({
			message: `git ${args[0]} failed during ${step}: ${detail}`,
			step,
		});
	}
}
