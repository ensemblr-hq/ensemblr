/**
 * Matches a GitHub pull-request URL such as
 * `https://github.com/owner/repo/pull/123`. Quotes are excluded from the tail so
 * the pattern also matches cleanly inside JSON-serialized tool output.
 */
const PULL_REQUEST_URL_PATTERN = /https:\/\/[^\s"']+\/pull\/\d+/;

/** Matches a `gh pr create` invocation regardless of intervening whitespace. */
const GH_PR_CREATE_PATTERN = /gh\s+pr\s+create\b/;

/**
 * Extract the first GitHub pull-request URL from arbitrary text.
 * @param text - Text that may contain a PR URL (e.g. `gh pr create` stdout).
 * @returns The matched PR URL, or undefined when none is present.
 */
export function extractPullRequestUrl(text: string): string | undefined {
	const match = text.match(PULL_REQUEST_URL_PATTERN);
	return match?.[0];
}

/**
 * Extract the PR number from a GitHub PR URL.
 * @param url - A GitHub pull-request URL.
 * @returns The parsed PR number, or undefined when the URL has none.
 */
export function extractPullRequestNumber(url: string): number | undefined {
	const match = url.match(/\/pull\/(\d+)/);
	const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Detect whether text invokes `gh pr create`. Used on tool-call *input*, where a
 * bare PR URL (e.g. `gh pr view <url>`) is not a creation signal, so only the
 * explicit create command counts.
 * @param text - Command input to inspect.
 * @returns True when the text runs `gh pr create`.
 */
export function mentionsGhPrCreate(text: string): boolean {
	return GH_PR_CREATE_PATTERN.test(text);
}

/**
 * Detect whether text carries a GitHub PR URL. Used on tool-call *output*, where
 * a freshly created PR's URL is the reliable creation signal.
 * @param text - Tool output to inspect.
 * @returns True when the text contains a PR URL.
 */
export function containsPullRequestUrl(text: string): boolean {
	return PULL_REQUEST_URL_PATTERN.test(text);
}
