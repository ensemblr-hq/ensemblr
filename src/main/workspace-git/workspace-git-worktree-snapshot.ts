/**
 * Writes the workspace's live working tree into a git tree object so a diff can
 * name it as an ordinary revision.
 *
 * This is what the live side of a turn diff needs. `git diff <checkpoint>`
 * cannot serve it: that form walks the *real* index, while a turn checkpoint is
 * captured with `add -A` into a throwaway one and therefore holds untracked
 * files the real index has never heard of. Every such file reads as a deletion,
 * and the untracked listing then appends the same path again as an addition —
 * one file, two mirror-image rows, and every file an earlier turn left
 * untracked leaking into every later turn's diff. Two trees have no index
 * between them and no such split.
 */

import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { LocalCommandResult } from '../commands/command-types.ts';

/** Runs one git command in a workspace directory, optionally with an env overlay. */
export type RunWorkspaceGit = (
	cwd: string,
	args: readonly string[],
	options?: { env?: Record<string, string>; maxOutputBytes?: number },
) => Promise<LocalCommandResult>;

/** A written tree object, or the git step that refused to produce one. */
export type WorktreeSnapshot =
	| { failure: LocalCommandResult; ok: false }
	| { ok: true; treeHash: string };

/**
 * Writes the working tree — tracked edits, deletions, and untracked files, with
 * `.gitignore` respected — into a tree object, leaving the workspace's own
 * index, HEAD, and refs untouched.
 * @param cwd - Absolute workspace directory to snapshot
 * @param runGit - Git runner, which must honour the returned env overlay
 * @returns The tree object's hash, or the failed git step
 */
export async function snapshotWorktreeTree({
	cwd,
	runGit,
}: {
	cwd: string;
	runGit: RunWorkspaceGit;
}): Promise<WorktreeSnapshot> {
	const directory = await mkdtemp(
		path.join(tmpdir(), 'ensemblr-worktree-snapshot-'),
	);
	const indexFile = path.join(directory, 'index');
	try {
		await warmIndex({ cwd, indexFile, runGit });
		const env = { GIT_INDEX_FILE: indexFile };
		const staged = await runGit(cwd, ['add', '-A', '--', '.'], { env });
		if (staged.status !== 'success') {
			return { failure: staged, ok: false };
		}
		const written = await runGit(cwd, ['write-tree'], { env });
		if (written.status !== 'success') {
			return { failure: written, ok: false };
		}
		const treeHash = written.stdout.trim();
		return treeHash ? { ok: true, treeHash } : { failure: written, ok: false };
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}

/**
 * Seeds the throwaway index from the workspace's own so `add -A` re-hashes only
 * what changed. Both indexes yield the same tree; an empty one costs a full
 * rehash of every tracked file, which measured ~6x slower on this repository,
 * and this runs on a polling read. A workspace with no index yet — or one being
 * rewritten as this reads it — is left to take the slower path.
 * @param cwd - Absolute workspace directory
 * @param indexFile - Throwaway index path to seed
 * @param runGit - Git runner used to locate the workspace's own index
 */
async function warmIndex({
	cwd,
	indexFile,
	runGit,
}: {
	cwd: string;
	indexFile: string;
	runGit: RunWorkspaceGit;
}): Promise<void> {
	const located = await runGit(cwd, ['rev-parse', '--git-path', 'index']);
	const source = located.status === 'success' ? located.stdout.trim() : '';
	if (!source) {
		return;
	}
	await copyFile(path.resolve(cwd, source), indexFile).catch(() => undefined);
}
