import type { GithubRepoRef } from '@/renderer/types/workbench';

/**
 * Extracts the `{ owner, repo }` pair from a GitHub remote URL, covering HTTPS,
 * SSH, and `git@`-style remotes (with or without a trailing `.git`). Returns
 * `null` when the host is not github.com or the URL cannot be parsed.
 */
export function parseGithubRepoFromRemoteUrl(
	remoteUrl: string | null | undefined,
): GithubRepoRef | null {
	if (!remoteUrl) {
		return null;
	}

	const match = remoteUrl
		.trim()
		.match(/github\.com[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/i);

	if (!match?.[1] || !match[2]) {
		return null;
	}

	return { owner: match[1], repo: match[2] };
}

/**
 * Builds the GitHub "compare" URL that opens the new-pull-request page in the
 * browser, pre-expanded. When `base` is known the range is `base...head`;
 * otherwise GitHub defaults the base to the repository's default branch. Branch
 * names are URL-encoded so a head like `user/feature` becomes `user%2Ffeature`.
 */
export function buildGithubCompareUrl({
	base,
	head,
	owner,
	repo,
}: {
	base?: string | null;
	head: string;
	owner: string;
	repo: string;
}): string {
	const range = base
		? `${encodeURIComponent(base)}...${encodeURIComponent(head)}`
		: encodeURIComponent(head);

	return `https://github.com/${owner}/${repo}/compare/${range}?body=&expand=1`;
}
