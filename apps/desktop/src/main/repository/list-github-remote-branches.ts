/**
 * Lists a GitHub repository's branches before anything is cloned, so the clone
 * dialog can offer the same branch picker the create-from-source picker uses.
 * Keyed by URL rather than repository id, because at this point no repository
 * row and no checkout exist.
 */

import type {
	GithubRemoteBranchListRequest,
	GithubRemoteBranchListResult,
} from '../../shared/ipc/contracts/clone';
import type { GithubFailure } from '../../shared/ipc/contracts/github';
import type { LocalCommandService } from '../commands/local-command';
import { fetchRemoteBranches, toBranchWires } from './github-branches.ts';
import { parseGithubUrl } from './github-url.ts';

/** Public surface of the pre-clone remote branch listing service. */
export interface GithubRemoteBranchListService {
	list: (
		request: GithubRemoteBranchListRequest,
	) => Promise<GithubRemoteBranchListResult>;
}

/** Options for {@link createGithubRemoteBranchListService}. */
export interface CreateGithubRemoteBranchListServiceOptions {
	localCommandService: LocalCommandService;
}

/**
 * Classifies a URL the picker cannot read a repository out of, matching the
 * codes the clone dialog's own prepare step raises for the same input so both
 * report it in the same words.
 * @param url - The URL as the renderer sent it.
 * @returns The failure to hand back.
 */
function urlFailure(url: string): GithubFailure {
	return url.trim()
		? { code: 'url-invalid', message: 'That repository URL is not valid.' }
		: { code: 'url-required', message: 'A repository URL is required.' };
}

/**
 * Builds the service the clone dialog's branch picker reads from. Like every
 * other `gh`-backed list, it degrades to an empty list plus a typed failure
 * rather than throwing, so the picker stays usable when `gh` is missing,
 * unauthenticated, or blind to a private repository.
 * @param options - Service dependencies.
 * @returns A {@link GithubRemoteBranchListService}.
 */
export function createGithubRemoteBranchListService({
	localCommandService,
}: CreateGithubRemoteBranchListServiceOptions): GithubRemoteBranchListService {
	return {
		list: async (request) => {
			const parsedUrl = parseGithubUrl(request.url);
			if (!parsedUrl) {
				return {
					branches: [],
					error: urlFailure(request.url),
					status: 'error',
				};
			}

			const result = await fetchRemoteBranches({
				localCommandService,
				target: {
					kind: 'coordinates',
					name: parsedUrl.repositoryName,
					owner: parsedUrl.owner,
				},
			});
			if (!result.ok) {
				return { branches: [], error: result.error, status: 'error' };
			}

			return { branches: toBranchWires(result.branches), status: 'ok' };
		},
	};
}
