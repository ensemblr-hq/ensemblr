import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { stripLaunchContextEnv } from '../environment/launch-env.ts';

const execFileAsync = promisify(execFile);

/**
 * Captures the full working-tree state of a git workspace (tracked changes AND
 * untracked files, `.gitignore` respected) into a commit reachable only from a
 * private ref. Uses a temporary index file so the user's real index, HEAD, and
 * branches are never touched (ADR 0012).
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

/** Diffs two tree-ish revisions (commit or tree hashes). */
export async function diffTrees({
	cwd,
	fromRev,
	toRev,
}: {
	cwd: string;
	fromRev: string;
	toRev: string;
}): Promise<GitDiffResult> {
	const [numstat, nameStatus, patch] = await Promise.all([
		runGit({
			args: ['diff', '--numstat', '-M', fromRev, toRev],
			cwd,
			step: 'diff-numstat',
		}),
		runGit({
			args: ['diff', '--name-status', '-M', fromRev, toRev],
			cwd,
			step: 'diff-name-status',
		}),
		runGit({
			args: ['diff', '-M', fromRev, toRev],
			cwd,
			step: 'diff-patch',
		}),
	]);

	const statusByPath = new Map<string, GitDiffFile['status']>();
	for (const line of nameStatus.split('\n')) {
		if (!line.trim()) {
			continue;
		}
		const [code = '', ...paths] = line.split('\t');
		const filePath = paths.at(-1) ?? '';
		statusByPath.set(filePath, statusFromCode(code));
	}

	const files: GitDiffFile[] = [];
	for (const line of numstat.split('\n')) {
		if (!line.trim()) {
			continue;
		}
		const [added = '', deleted = '', ...paths] = line.split('\t');
		const filePath = paths.at(-1) ?? '';
		files.push({
			additions: added === '-' ? null : Number.parseInt(added, 10),
			deletions: deleted === '-' ? null : Number.parseInt(deleted, 10),
			path: filePath,
			status: statusByPath.get(filePath) ?? 'modified',
		});
	}

	return { files, patch };
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
 * Map a git name-status code letter to a diff file status.
 * @param code - Name-status code from `git diff --name-status`
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
 * Run a git command with a launch-context-scrubbed environment, returning
 * trimmed stdout and throwing a {@link GitCheckpointError} on failure.
 * @param args - Git arguments to pass
 * @param cwd - Directory to run git in
 * @param env - Extra environment overlaid on the scrubbed process env
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
			// Strip launch-context vars AFTER the caller overlay so a git subprocess
			// (askpass/credential helper) can't make macOS relaunch Ensemblr.
			env: stripLaunchContextEnv({ ...process.env, ...env }),
			maxBuffer: 16 * 1024 * 1024,
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
