/**
 * Places a link's project on one of the configured accounts. A link committed
 * to a repository — or discovered in a `.infisical.json` — names a project but
 * not the local credentials that reach it, so the account half has to be
 * inferred. Both strategies refuse an ambiguous answer, and both refuse to
 * cross instances: spending one organization's credentials against another's
 * project is worse than leaving the link unresolved until the user picks.
 */
import type { InfisicalAccountStore } from './infisical-account-store.ts';
import type { InfisicalClient } from './infisical-client.ts';

/**
 * How long a "no account reaches this project" answer is trusted. A miss is
 * usually permanent, but the remedy — granting the Machine Identity access in
 * Infisical — happens outside Ensemblr and raises no event here, so a memo
 * kept for the process lifetime would strand the user on a stale no.
 */
const NEGATIVE_MATCH_TTL_MS = 5 * 60 * 1000;

/** A memoized answer; positives never expire, misses expire on their own. */
interface MemoizedMatch {
	accountId: string | null;
	expiresAt: number | null;
}

/** Resolves which configured account a link's project belongs to. */
export interface InfisicalAccountMatcher {
	/** Drops the project scan's memo, so the next match re-reads every account. */
	invalidate: () => void;
	/**
	 * Matches by the instance a committed block names. Synchronous, because it
	 * reads only local account rows.
	 */
	matchBySiteUrl: (siteUrl: string | null) => string | null;
	/**
	 * Matches by asking every account which projects it can reach — the only
	 * check available for a link no instance URL resolves on its own, since
	 * Infisical exposes no lookup of a single project by id. A link that names
	 * an instance is only ever matched against accounts on that instance.
	 * Memoized per instance and project id.
	 */
	matchByProjectId: (input: {
		projectId: string;
		siteUrl: string | null;
	}) => Promise<string | null>;
}

/** Options for {@link createInfisicalAccountMatcher}. */
export interface CreateInfisicalAccountMatcherOptions {
	accountStore: InfisicalAccountStore;
	client: InfisicalClient;
	now?: () => Date;
}

/**
 * Builds the account matcher.
 * @param options - Account store, the client used to scan projects, and an injectable clock.
 * @returns A fresh {@link InfisicalAccountMatcher}.
 */
export function createInfisicalAccountMatcher({
	accountStore,
	client,
	now = () => new Date(),
}: CreateInfisicalAccountMatcherOptions): InfisicalAccountMatcher {
	const matchesByProjectId = new Map<string, MemoizedMatch>();

	/**
	 * Asks one account whether it reaches a project, treating a failure as "no"
	 * so an unreachable account never hides a match another account can answer.
	 * @param accountId - Account to ask.
	 * @param projectId - Project to look for.
	 * @returns The account id when it reaches the project, or null.
	 */
	async function reaches(
		accountId: string,
		projectId: string,
	): Promise<{ accountId: string | null; failed: boolean }> {
		try {
			const projects = await client.listProjects(accountId);
			const found = projects.some((project) => project.id === projectId);

			return { accountId: found ? accountId : null, failed: false };
		} catch {
			return { accountId: null, failed: true };
		}
	}

	/**
	 * Reads a memoized answer, discarding a miss that has outlived its TTL.
	 * @param key - Memo key for the instance and project.
	 * @returns The remembered answer, or null when there is none to trust.
	 */
	function readMemo(key: string): MemoizedMatch | null {
		const memo = matchesByProjectId.get(key);

		if (!memo) {
			return null;
		}

		if (memo.expiresAt !== null && memo.expiresAt <= now().getTime()) {
			matchesByProjectId.delete(key);

			return null;
		}

		return memo;
	}

	return {
		invalidate: () => {
			matchesByProjectId.clear();
		},

		matchBySiteUrl: (siteUrl) => {
			if (!siteUrl) {
				return null;
			}

			const matches = accountStore
				.list()
				.filter((account) => account.siteUrl === siteUrl);

			return matches.length === 1 ? (matches.at(0)?.id ?? null) : null;
		},

		matchByProjectId: async ({ projectId, siteUrl }) => {
			if (!projectId) {
				return null;
			}

			const key = `${siteUrl ?? ''}\n${projectId}`;
			const memo = readMemo(key);

			if (memo) {
				return memo.accountId;
			}

			const candidates = accountStore
				.list()
				.filter((account) => onSameInstance(account.siteUrl, siteUrl));
			const outcomes = await Promise.all(
				candidates.map((account) => reaches(account.id, projectId)),
			);
			const matched = outcomes.flatMap((outcome) =>
				outcome.accountId ? [outcome.accountId] : [],
			);
			const match = matched.length === 1 ? (matched.at(0) ?? null) : null;

			if (!outcomes.some((outcome) => outcome.failed)) {
				matchesByProjectId.set(key, {
					accountId: match,
					expiresAt: match ? null : now().getTime() + NEGATIVE_MATCH_TTL_MS,
				});
			}

			return match;
		},
	};
}

/**
 * Decides whether an account sits on the instance a link names. Compared by
 * origin rather than by string: a `.infisical.json` carries the CLI's own
 * `domain`, which conventionally ends in `/api`, while an Ensemblr account
 * stores the bare instance URL — the same deployment written two ways.
 * @param accountSiteUrl - Instance URL stored against the account.
 * @param linkSiteUrl - Instance URL the link names, or null when it names none.
 * @returns True when the link names no instance, or when both name the same one.
 */
function onSameInstance(
	accountSiteUrl: string,
	linkSiteUrl: string | null,
): boolean {
	if (!linkSiteUrl) {
		return true;
	}

	return readOrigin(accountSiteUrl) === readOrigin(linkSiteUrl);
}

/**
 * Reduces an instance URL to its origin, so a path suffix or trailing slash
 * does not read as a different deployment.
 * @param siteUrl - Instance URL to reduce.
 * @returns The origin, or the trimmed input when it does not parse as a URL.
 */
function readOrigin(siteUrl: string): string {
	try {
		return new URL(siteUrl).origin;
	} catch {
		return siteUrl.trim();
	}
}
