import type { LocalCommandResult } from '../commands/local-command';
import {
	type GithubRepositoryCoordinates,
	parseGithubRemoteUrl,
} from '../repository/github-url.ts';
import { classifyCommandFailure } from './gh-failures.ts';
import {
	parseRemoteConfig,
	REMOTE_CONFIG_PATTERN,
	RESOLVED_TO_THIS_REMOTE,
	type RemoteConfig,
	type RemoteEntry,
} from './remote-config.ts';

/**
 * Which GitHub repository a `gh` call addresses. `default` leaves the choice to
 * `gh`, which resolves it from the checkout's remotes; `named` pins one.
 */
export type PullRequestRepository =
	| { kind: 'default' }
	| ({ kind: 'named' } & GithubRepositoryCoordinates);

/** The repository `gh` resolves for a checkout on its own. */
const DEFAULT_REPOSITORY: PullRequestRepository = { kind: 'default' };

/** What GitHub's GraphQL API answers for a repository it cannot find. */
const UNRESOLVABLE_REPOSITORY_MARKER = 'could not resolve to a repository';

/**
 * The `--repo` flag that points a `gh pr` command at a named repository.
 * @param repository - The repository to address.
 * @returns The flag and its value, or nothing for the default repository.
 */
export function repositoryFlag(repository: PullRequestRepository): string[] {
	return repository.kind === 'named'
		? ['--repo', `${repository.owner}/${repository.name}`]
		: [];
}

/**
 * A REST path under the repository, left for `gh api` to fill from the
 * checkout's remotes when the repository is the default one.
 * @param repository - The repository to address.
 * @param suffix - The path below `repos/<owner>/<name>/`.
 * @returns The path to hand `gh api`.
 */
export function repositoryApiPath(
	repository: PullRequestRepository,
	suffix: string,
): string {
	return repository.kind === 'named'
		? `repos/${repository.owner}/${repository.name}/${suffix}`
		: `repos/{owner}/{repo}/${suffix}`;
}

/**
 * The `owner` and `name` GraphQL variables for the repository. The placeholders
 * only expand under `-F`, while a literal name goes through `-f` because `-F`
 * coerces an integer-looking name such as `2048` to a number GraphQL rejects
 * against `String!`.
 * @param repository - The repository to address.
 * @returns The `gh api graphql` field arguments.
 */
export function repositoryGraphqlVariables(
	repository: PullRequestRepository,
): string[] {
	return repository.kind === 'named'
		? ['-f', `owner=${repository.owner}`, '-f', `name=${repository.name}`]
		: ['-F', 'owner={owner}', '-F', 'name={repo}'];
}

/**
 * Runs a `gh pr` command for a branch's pull request in the repository `gh`
 * resolves for the checkout and, when that one has no pull request for the
 * branch, once more in the repository the branch was pushed to.
 *
 * `gh repo clone` of a fork adds the parent as `upstream` and marks it as the
 * resolved base, so every implicit `gh pr` call in that checkout reads the
 * parent. That is right for a pull request proposed upstream and wrong for one
 * opened from a branch into the fork's own default branch, which only exists in
 * the fork. The default goes first so a checkout without a fork pays nothing
 * extra, and the retry is safe for a command that changes state because one
 * that found no pull request changed nothing.
 * @param options - The branch's local name and the remote branch `gh` is asked
 * about, which the retry needs because `--repo` requires an explicit head; a
 * runner for the `gh` command against one repository; and a runner for `git`.
 * @returns The command's result and the repository that produced it.
 */
export async function runInPullRequestRepository({
	branchName,
	headRef,
	runGh,
	runGit,
}: {
	branchName: string | null;
	headRef: string | null;
	runGh: (repository: PullRequestRepository) => Promise<LocalCommandResult>;
	runGit: (args: readonly string[]) => Promise<LocalCommandResult>;
}): Promise<{
	repository: PullRequestRepository;
	result: LocalCommandResult;
}> {
	const result = await runGh(DEFAULT_REPOSITORY);
	const headRepository =
		headRef && branchName && isNoPullRequest(result)
			? await readHeadRepository({ branchName, runGit })
			: null;
	if (!headRepository) {
		return { repository: DEFAULT_REPOSITORY, result };
	}
	const headResult = await runGh(headRepository);
	return isUnresolvableRepository(headResult)
		? { repository: DEFAULT_REPOSITORY, result }
		: { repository: headRepository, result: headResult };
}

/**
 * Whether GitHub could not find the repository a command named. A remote left
 * pointing at a fork that was since deleted or renamed answers this way on every
 * call — GraphQL does not follow a rename — and no pull request can live in a
 * repository GitHub cannot resolve, so the retry settles on the default's
 * "no pull request" rather than reporting a failure that never clears.
 * @param result - The retried command's result.
 * @returns True when GitHub reported the repository as unresolvable.
 */
function isUnresolvableRepository(result: LocalCommandResult): boolean {
	return (
		result.status !== 'success' &&
		result.stderr.toLowerCase().includes(UNRESOLVABLE_REPOSITORY_MARKER)
	);
}

/**
 * Whether a `gh pr` command failed only because the repository it asked has no
 * pull request for the branch.
 * @param result - The command's result.
 * @returns True for a "no pull requests found" failure.
 */
function isNoPullRequest(result: LocalCommandResult): boolean {
	return (
		result.status !== 'success' &&
		classifyCommandFailure(result, '').code === 'no-pull-request'
	);
}

/**
 * Finds the repository a branch was pushed to when `gh` would not look there on
 * its own. The branch's tracked remote names the repository its head lives in,
 * which is the one other place its pull request can be.
 * @param options - The branch to resolve and a runner for `git` in the checkout.
 * @returns The branch's own repository, or null when `gh` already addresses it,
 * the checkout has a single remote, or the remote is not on github.com.
 */
async function readHeadRepository({
	branchName,
	runGit,
}: {
	branchName: string;
	runGit: (args: readonly string[]) => Promise<LocalCommandResult>;
}): Promise<PullRequestRepository | null> {
	const result = await runGit([
		'config',
		'--get-regexp',
		REMOTE_CONFIG_PATTERN,
	]);
	if (result.status !== 'success') {
		return null;
	}
	const repository = selectHeadRepository(
		parseRemoteConfig(result.stdout),
		branchName,
	);
	return repository ? { kind: 'named', ...repository } : null;
}

/**
 * Picks the github.com repository a branch tracks, unless it is the one `gh`
 * already resolves. A checkout with a single remote leaves `gh` no other choice,
 * so its answer is already final.
 * @param config - The checkout's parsed remote configuration.
 * @param branchName - The local branch whose remote to read.
 * @returns The branch's repository, or null when there is nothing else to ask.
 */
function selectHeadRepository(
	config: RemoteConfig,
	branchName: string,
): GithubRepositoryCoordinates | null {
	if (config.remotes.size < 2) {
		return null;
	}
	const remoteName = config.branchRemotes.get(branchName);
	const url = remoteName ? config.remotes.get(remoteName)?.url : undefined;
	const repository = url ? parseGithubRemoteUrl(url) : null;
	if (!repository) {
		return null;
	}
	return resolvedRepositoryKeys(config.remotes).includes(
		repositoryKey(repository),
	)
		? null
		: repository;
}

/**
 * The repositories `gh` has been told to resolve to, as comparable keys. A
 * resolution of `base` names the remote's own repository; any other value is
 * the `owner/name` it was pointed at.
 * @param remotes - The checkout's remotes.
 * @returns Lower-cased `owner/name` keys.
 */
function resolvedRepositoryKeys(
	remotes: ReadonlyMap<string, RemoteEntry>,
): string[] {
	return [...remotes.values()].flatMap(({ ghResolved, url }) => {
		if (!ghResolved) {
			return [];
		}
		if (ghResolved !== RESOLVED_TO_THIS_REMOTE) {
			return [ghResolved.toLowerCase()];
		}
		const repository = url ? parseGithubRemoteUrl(url) : null;
		return repository ? [repositoryKey(repository)] : [];
	});
}

/**
 * A case-insensitive key for a repository, since GitHub treats owner and
 * repository names that way.
 * @param repository - The repository's coordinates.
 * @returns The lower-cased `owner/name`.
 */
function repositoryKey(repository: GithubRepositoryCoordinates): string {
	return `${repository.owner}/${repository.name}`.toLowerCase();
}
