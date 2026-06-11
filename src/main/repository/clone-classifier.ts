import type { CloneGithubRepositoryDiagnostic } from '../../shared/ipc';

/** Inputs for {@link classifyCloneFailure}. */
export interface ClassifyCloneFailureOptions {
	exitCode: number | null;
	stderr: string;
	targetPath: string;
}

/**
 * Maps the captured stderr from a failed clone into a categorised diagnostic.
 * Pattern matching is intentionally substring-based so we cover both `gh` and
 * `git` output without coupling to exact wording.
 */
export function classifyCloneFailure({
	exitCode,
	stderr,
	targetPath,
}: ClassifyCloneFailureOptions): CloneGithubRepositoryDiagnostic {
	const lower = stderr.toLowerCase();

	if (
		lower.includes('authentication failed') ||
		lower.includes('could not read username') ||
		lower.includes('permission denied (publickey)') ||
		lower.includes('gh auth login') ||
		lower.includes('401')
	) {
		return {
			code: 'auth',
			message:
				'GitHub authentication failed. Run gh auth login --hostname github.com or update your SSH credentials, then retry.',
			severity: 'error',
		};
	}

	if (
		lower.includes('repository not found') ||
		lower.includes('404') ||
		lower.includes('not found')
	) {
		return {
			code: 'repository-not-found',
			message:
				'GitHub could not find this repository. Check the URL and that your account has access.',
			severity: 'error',
		};
	}

	if (
		lower.includes('could not resolve host') ||
		lower.includes('failed to connect') ||
		lower.includes('network is unreachable') ||
		lower.includes('timed out') ||
		lower.includes('connection refused')
	) {
		return {
			code: 'network',
			message:
				'GitHub is unreachable. Check your network connection and retry.',
			severity: 'error',
		};
	}

	if (lower.includes('already exists') && lower.includes('destination path')) {
		return {
			code: 'destination-exists',
			message: `A directory already exists at ${targetPath}. Remove it or pick a different location.`,
			path: targetPath,
			severity: 'error',
		};
	}

	if (lower.includes('permission denied')) {
		return {
			code: 'permission',
			message: `Permission denied when writing to ${targetPath}.`,
			path: targetPath,
			severity: 'error',
		};
	}

	return {
		code: 'git-failed',
		message: `Clone failed${exitCode !== null ? ` with exit code ${exitCode}` : ''}.`,
		severity: 'error',
	};
}
