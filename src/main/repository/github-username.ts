import type { LocalCommandService } from '../commands/local-command';
import { firstLine } from './first-line.ts';

/** Resolves (and caches) the authenticated GitHub login via `gh`. */
export interface GithubUsernameResolver {
	/** The GitHub login, or `null` when gh is missing / unauthenticated. */
	resolve: () => Promise<string | null>;
}

/** Options for {@link createGithubUsernameResolver}. */
export interface CreateGithubUsernameResolverOptions {
	localCommandService: LocalCommandService;
}

const GH_TIMEOUT_MS = 10_000;
const GH_MAX_OUTPUT_BYTES = 1024 * 64;

/**
 * Builds a resolver for the authenticated GitHub username, used to prefix new
 * workspace branches when the user picks the "GitHub username" branch-prefix
 * source. The login is cached after the first successful lookup so repeated
 * workspace creation does not re-spawn `gh`; failures are not cached so a later
 * `gh auth login` is picked up within the same session.
 * @param options - Service dependencies.
 * @returns A {@link GithubUsernameResolver}.
 */
export function createGithubUsernameResolver({
	localCommandService,
}: CreateGithubUsernameResolverOptions): GithubUsernameResolver {
	let cached: string | null | undefined;

	return {
		resolve: async () => {
			if (cached !== undefined) {
				return cached;
			}

			const result = await localCommandService.run({
				args: ['api', 'user', '--jq', '.login'],
				command: 'gh',
				maxOutputBytes: GH_MAX_OUTPUT_BYTES,
				timeoutMs: GH_TIMEOUT_MS,
			});

			if (result.status !== 'success') {
				// Don't cache: auth may be fixed later in the session.
				return null;
			}

			const login = firstLine(result.stdout).trim();
			cached = login.length > 0 ? login : null;
			return cached;
		},
	};
}
