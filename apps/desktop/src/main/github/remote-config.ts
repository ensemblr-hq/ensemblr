import {
	type GithubRepositoryCoordinates,
	parseGithubRemoteUrl,
	parseGithubUrl,
} from '../repository/github-url.ts';

/**
 * The git config keys {@link parseRemoteConfig} reads, for one
 * `git config --get-regexp` call: every remote's URL and `gh` resolution, and
 * every branch's tracked remote.
 */
export const REMOTE_CONFIG_PATTERN =
	'^(remote\\..+\\.(url|gh-resolved)|branch\\..+\\.remote)$';
const REMOTE_URL_KEY = /^remote\.(.+)\.url$/;
const REMOTE_RESOLUTION_KEY = /^remote\.(.+)\.gh-resolved$/;
const BRANCH_REMOTE_KEY = /^branch\.(.+)\.remote$/;
/** The value `gh repo set-default` writes on the remote it resolved to. */
export const RESOLVED_TO_THIS_REMOTE = 'base';

/** One configured remote: its URL and the `gh` resolution recorded on it. */
export interface RemoteEntry {
	ghResolved?: string;
	url?: string;
}

/** The remote configuration of a checkout, keyed by remote and branch name. */
export interface RemoteConfig {
	branchRemotes: ReadonlyMap<string, string>;
	remotes: ReadonlyMap<string, RemoteEntry>;
}

/** One `key value` pair from `git config --get-regexp`. */
interface ConfigEntry {
	key: string;
	value: string;
}

/**
 * Parses `git config --get-regexp` output for remote URLs, `gh` resolutions,
 * and branch remotes. The first value wins where a key repeats, as it does for
 * a remote with several URLs.
 * @param stdout - The command's output, one `key value` pair per line.
 * @returns The remote configuration.
 */
export function parseRemoteConfig(stdout: string): RemoteConfig {
	const entries = stdout.split('\n').flatMap(parseConfigLine);
	const urls = valuesByName(entries, REMOTE_URL_KEY);
	const resolutions = valuesByName(entries, REMOTE_RESOLUTION_KEY);
	const remoteNames = new Set([...urls.keys(), ...resolutions.keys()]);
	return {
		branchRemotes: valuesByName(entries, BRANCH_REMOTE_KEY),
		remotes: new Map(
			[...remoteNames].map((name) => [
				name,
				{ ghResolved: resolutions.get(name), url: urls.get(name) },
			]),
		),
	};
}

/**
 * The github.com repository a named remote points at.
 * @param remotes - The checkout's remotes.
 * @param name - The remote to read, such as `origin`.
 * @returns The remote's repository, or null when it is absent or not on github.com.
 */
export function remoteRepository(
	remotes: ReadonlyMap<string, RemoteEntry>,
	name: string,
): GithubRepositoryCoordinates | null {
	const url = remotes.get(name)?.url;
	return url ? parseGithubRemoteUrl(url) : null;
}

/**
 * The repository `gh repo set-default` pointed the checkout at. A resolution of
 * `base` names the remote's own repository; any other value is the
 * `owner/name` it was pointed at.
 * @param remotes - The checkout's remotes.
 * @returns The first resolved repository on github.com, or null when none is set.
 */
export function ghResolvedRepository(
	remotes: ReadonlyMap<string, RemoteEntry>,
): GithubRepositoryCoordinates | null {
	for (const { ghResolved, url } of remotes.values()) {
		const repository = readResolution(ghResolved, url);
		if (repository) {
			return repository;
		}
	}
	return null;
}

/**
 * Reads one remote's `gh` resolution as repository coordinates.
 * @param ghResolved - The remote's `gh-resolved` value, if any.
 * @param url - The remote's URL, which a `base` resolution refers to.
 * @returns The resolved repository, or null when unset or unreadable.
 */
function readResolution(
	ghResolved: string | undefined,
	url: string | undefined,
): GithubRepositoryCoordinates | null {
	if (!ghResolved) {
		return null;
	}
	if (ghResolved === RESOLVED_TO_THIS_REMOTE) {
		return url ? parseGithubRemoteUrl(url) : null;
	}
	const named = parseGithubUrl(ghResolved);
	return named ? { name: named.repositoryName, owner: named.owner } : null;
}

/**
 * Collects the values of every key a pattern matches, keyed by the remote or
 * branch name the pattern captures. Built from the reversed list so the first
 * value of a repeated key is the one that survives.
 * @param entries - Parsed config pairs.
 * @param pattern - A key pattern whose first group is the name.
 * @returns The value per name.
 */
function valuesByName(
	entries: readonly ConfigEntry[],
	pattern: RegExp,
): Map<string, string> {
	return new Map(
		entries
			.flatMap(({ key, value }) => {
				const name = key.match(pattern)?.[1];
				return name ? [[name, value] as const] : [];
			})
			.reverse(),
	);
}

/**
 * Splits one `git config --get-regexp` line at its first space.
 * @param line - A `key value` line.
 * @returns The pair, or nothing for a line without a value.
 */
function parseConfigLine(line: string): ConfigEntry[] {
	const separator = line.indexOf(' ');
	if (separator <= 0) {
		return [];
	}
	const value = line.slice(separator + 1).trim();
	return value ? [{ key: line.slice(0, separator), value }] : [];
}
