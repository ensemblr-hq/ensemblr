import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

/** Outcome of inspecting a candidate path with git. */
export interface GitRepositoryProbe {
	defaultBranch: string | null;
	error?: string;
	isGitRepository: boolean;
	remoteUrl: string | null;
	topLevel: string | null;
}

/** Pluggable hook used to probe a directory with git; swapped in tests. */
export type GitRepositoryProbeFn = (
	repositoryPath: string,
) => Promise<GitRepositoryProbe>;

/** Outcome of inspecting a candidate path as a git worktree. */
export interface GitWorktreeMetadata {
	defaultBranch: string | null;
	error?: string;
	gitCommonDir: string | null;
	gitDir: string | null;
	headBranch: string | null;
	isWorktree: boolean;
	mainRepositoryPath: string | null;
	remoteUrl: string | null;
	topLevel: string | null;
}

/** Pluggable hook used to probe a candidate worktree path; swapped in tests. */
export type GitWorktreeProbeFn = (
	worktreePath: string,
) => Promise<GitWorktreeMetadata>;

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 5000;

/**
 * Detects whether the given absolute path is a git repository and extracts the
 * remote origin URL plus the locally configured default branch when available.
 *
 * Async to keep Electron's main thread responsive when git stalls (slow disk,
 * NFS mount, hung lockfile).
 * @param repositoryPath - Absolute filesystem path to inspect.
 * @returns A {@link GitRepositoryProbe} describing what was found.
 */
export async function probeGitRepository(
	repositoryPath: string,
): Promise<GitRepositoryProbe> {
	if (!repositoryPath.trim()) {
		return emptyProbe('No repository path was provided.');
	}

	const resolved = path.resolve(repositoryPath);

	if (!existsSync(resolved)) {
		return emptyProbe('The selected path does not exist.');
	}

	if (!isDirectory(resolved)) {
		return emptyProbe('The selected path is not a directory.');
	}

	let topLevel: string;

	try {
		topLevel = await runGitCommand(resolved, ['rev-parse', '--show-toplevel']);
	} catch (error) {
		return {
			defaultBranch: null,
			error: formatGitError(
				error,
				'The selected path is not inside a git repository.',
			),
			isGitRepository: false,
			remoteUrl: null,
			topLevel: null,
		};
	}

	if (path.resolve(topLevel) !== resolved) {
		return {
			defaultBranch: null,
			error:
				'Select the repository root; this path is inside a git worktree, not at its top level.',
			isGitRepository: false,
			remoteUrl: null,
			topLevel: path.resolve(topLevel),
		};
	}

	const [defaultBranch, remoteUrl] = await Promise.all([
		readDefaultBranch(resolved),
		readRemoteUrl(resolved),
	]);

	return {
		defaultBranch,
		isGitRepository: true,
		remoteUrl,
		topLevel: resolved,
	};
}

/**
 * Inspects a candidate path as a git worktree, extracting head branch, main
 * repository path, remote URL, and the locally configured default branch.
 *
 * A path qualifies as a linked worktree when `git rev-parse --git-common-dir`
 * resolves outside the candidate's own `.git` directory; main checkouts are
 * reported with `isWorktree: false` so callers can skip them.
 * @param worktreePath - Absolute filesystem path to inspect.
 * @returns A {@link GitWorktreeMetadata} describing what was found.
 */
export async function probeGitWorktreeMetadata(
	worktreePath: string,
): Promise<GitWorktreeMetadata> {
	if (!worktreePath.trim()) {
		return emptyWorktreeMetadata('No worktree path was provided.');
	}

	const resolved = path.resolve(worktreePath);

	if (!existsSync(resolved)) {
		return emptyWorktreeMetadata('The selected path does not exist.');
	}

	if (!isDirectory(resolved)) {
		return emptyWorktreeMetadata('The selected path is not a directory.');
	}

	let topLevel: string;

	try {
		topLevel = await runGitCommand(resolved, ['rev-parse', '--show-toplevel']);
	} catch (error) {
		return {
			defaultBranch: null,
			error: formatGitError(
				error,
				'The selected path is not inside a git repository.',
			),
			gitCommonDir: null,
			gitDir: null,
			headBranch: null,
			isWorktree: false,
			mainRepositoryPath: null,
			remoteUrl: null,
			topLevel: null,
		};
	}

	const resolvedTopLevel = path.resolve(topLevel);

	if (resolvedTopLevel !== resolved) {
		return {
			defaultBranch: null,
			error: 'The path is inside a worktree but not at the worktree top level.',
			gitCommonDir: null,
			gitDir: null,
			headBranch: null,
			isWorktree: false,
			mainRepositoryPath: null,
			remoteUrl: null,
			topLevel: resolvedTopLevel,
		};
	}

	let gitDir: string;
	let gitCommonDir: string;

	try {
		[gitDir, gitCommonDir] = await Promise.all([
			runGitCommand(resolved, ['rev-parse', '--absolute-git-dir']),
			runGitCommand(resolved, ['rev-parse', '--git-common-dir']),
		]);
	} catch (error) {
		return {
			defaultBranch: null,
			error: formatGitError(error, 'Failed to inspect the worktree git dir.'),
			gitCommonDir: null,
			gitDir: null,
			headBranch: null,
			isWorktree: false,
			mainRepositoryPath: null,
			remoteUrl: null,
			topLevel: resolvedTopLevel,
		};
	}

	const resolvedGitDir = path.resolve(gitDir);
	const resolvedCommonDir = path.isAbsolute(gitCommonDir)
		? path.resolve(gitCommonDir)
		: path.resolve(resolved, gitCommonDir);
	const isWorktree = resolvedGitDir !== resolvedCommonDir;
	const mainRepositoryPath = isWorktree
		? deriveMainRepositoryPath(resolvedCommonDir)
		: resolvedTopLevel;
	const [headBranch, remoteUrl, defaultBranch] = await Promise.all([
		readHeadBranch(resolved),
		readRemoteUrl(resolved),
		readDefaultBranch(resolved),
	]);

	return {
		defaultBranch,
		gitCommonDir: resolvedCommonDir,
		gitDir: resolvedGitDir,
		headBranch,
		isWorktree,
		mainRepositoryPath,
		remoteUrl,
		topLevel: resolvedTopLevel,
	};
}

/**
 * Reads `origin` from `git config`; missing remotes are not an error.
 * @param repositoryPath - Resolved repository top level.
 * @returns The remote URL or `null` when no `origin` is configured.
 */
async function readRemoteUrl(repositoryPath: string): Promise<string | null> {
	try {
		return (
			(await runGitCommand(repositoryPath, [
				'config',
				'--get',
				'remote.origin.url',
			])) || null
		);
	} catch {
		return null;
	}
}

/**
 * Reads the locally configured default branch, falling back to the current
 * HEAD branch when no `init.defaultBranch` or `origin/HEAD` is recorded.
 * @param repositoryPath - Resolved repository top level.
 * @returns A branch name or `null` when none can be determined.
 */
async function readDefaultBranch(
	repositoryPath: string,
): Promise<string | null> {
	try {
		const symbolic = await runGitCommand(repositoryPath, [
			'symbolic-ref',
			'--quiet',
			'--short',
			'refs/remotes/origin/HEAD',
		]);

		if (symbolic) {
			const slashAt = symbolic.indexOf('/');
			const branchName = slashAt >= 0 ? symbolic.slice(slashAt + 1) : null;
			if (branchName) {
				return branchName;
			}
		}
	} catch {
		// Falls through to local HEAD lookup below.
	}

	try {
		const head = await runGitCommand(repositoryPath, [
			'rev-parse',
			'--abbrev-ref',
			'HEAD',
		]);

		return head && head !== 'HEAD' ? head : null;
	} catch {
		return null;
	}
}

/**
 * Executes `git -C <path> <args>` and returns trimmed stdout.
 * @param repositoryPath - Working directory for the git invocation.
 * @param args - Git arguments after the `-C <path>` prefix.
 * @returns Trimmed stdout.
 */
async function runGitCommand(
	repositoryPath: string,
	args: string[],
): Promise<string> {
	const { stdout } = await execFileAsync(
		'git',
		['-C', repositoryPath, ...args],
		{
			encoding: 'utf8',
			timeout: GIT_COMMAND_TIMEOUT_MS,
		},
	);

	return stdout.toString().trim();
}

/**
 * Reads the worktree's current HEAD branch, returning `null` for detached HEAD.
 * @param worktreePath - Resolved worktree top level.
 * @returns The branch name or `null`.
 */
async function readHeadBranch(worktreePath: string): Promise<string | null> {
	try {
		const head = await runGitCommand(worktreePath, [
			'rev-parse',
			'--abbrev-ref',
			'HEAD',
		]);

		return head && head !== 'HEAD' ? head : null;
	} catch {
		return null;
	}
}

/**
 * Derives the main repository path from a `git-common-dir`, stripping the
 * trailing `.git` segment when present.
 * @param commonDir - Resolved common git dir.
 * @returns The repository top level, or `null` if unable to derive.
 */
function deriveMainRepositoryPath(commonDir: string): string | null {
	const base = path.basename(commonDir);

	if (base === '.git') {
		return path.dirname(commonDir);
	}

	if (base === 'git') {
		return path.dirname(commonDir);
	}

	return path.dirname(commonDir);
}

/** Builds a metadata describing a non-worktree candidate with a single error. */
function emptyWorktreeMetadata(error: string): GitWorktreeMetadata {
	return {
		defaultBranch: null,
		error,
		gitCommonDir: null,
		gitDir: null,
		headBranch: null,
		isWorktree: false,
		mainRepositoryPath: null,
		remoteUrl: null,
		topLevel: null,
	};
}

/** Tests whether a resolved path is a directory; missing entries return `false`. */
function isDirectory(filePath: string): boolean {
	try {
		return statSync(filePath).isDirectory();
	} catch {
		return false;
	}
}

/** Builds a probe describing a non-git candidate with a single error message. */
function emptyProbe(error: string): GitRepositoryProbe {
	return {
		defaultBranch: null,
		error,
		isGitRepository: false,
		remoteUrl: null,
		topLevel: null,
	};
}

/** Coerces a thrown git error into a user-facing message; prefers stderr. */
function formatGitError(error: unknown, fallback: string): string {
	if (typeof error === 'object' && error !== null) {
		const stderr = (error as { stderr?: Buffer | string }).stderr;
		const text =
			typeof stderr === 'string'
				? stderr.trim()
				: stderr
					? stderr.toString().trim()
					: '';
		if (text) {
			return text;
		}
	}

	if (error instanceof Error && error.message.trim()) {
		return error.message.trim();
	}

	return fallback;
}
