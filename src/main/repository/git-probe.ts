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
