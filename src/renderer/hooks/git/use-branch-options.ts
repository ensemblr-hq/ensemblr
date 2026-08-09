import { useQuery } from '@tanstack/react-query';

import { repositoryBranchesQuery } from '@/renderer/api/ensemblr/repository-sources';
import type { GithubFailure } from '@/shared/ipc/contracts/github';
import type { RepositoryBranchWire } from '@/shared/ipc/contracts/workspace-sources';

/** Branch rows for a picker, plus the states it has to render instead of a list. */
export interface BranchOptionsState {
	branches: RepositoryBranchWire[];
	error: GithubFailure | null;
	isLoading: boolean;
}

/**
 * Loads a repository's remote branches for a branch picker, only while the
 * picker is open so the query's poll does not run behind a closed popover.
 * A `gh` failure surfaces as a typed error rather than an empty list, since the
 * two are indistinguishable to the user otherwise.
 * @param repositoryId - Repository whose branches to list.
 * @param open - Whether the picker is currently open.
 * @returns The branch rows plus loading and error state.
 */
export function useBranchOptions(
	repositoryId: string,
	open: boolean,
): BranchOptionsState {
	const query = useQuery({
		...repositoryBranchesQuery(repositoryId),
		enabled: open && repositoryId.length > 0,
	});

	return {
		branches: query.data?.branches ?? [],
		error: resolveFailure(query.data, query.error),
		isLoading: query.isLoading,
	};
}

/**
 * Picks the failure to show, preferring the service's typed one. A rejected
 * call carries no `GithubFailure`, so it is wrapped rather than dropped —
 * leaving it out renders a broken bridge as "no remote branches found".
 * @param data - The query payload, absent while loading or after a rejection.
 * @param thrown - The error the query rejected with, if it did.
 * @returns The failure to render, or null when there is none.
 */
function resolveFailure(
	data:
		| { status: 'error'; error: GithubFailure }
		| { status: 'ok' }
		| undefined,
	thrown: Error | null,
): GithubFailure | null {
	if (data?.status === 'error') {
		return data.error;
	}
	if (thrown) {
		return {
			code: 'command-failed',
			// i18next-instrument-ignore -- English fallback behind the code the
			// renderer translates; see githubFailureText.
			message: 'Could not load branches for this repository.',
			remediation: thrown.message,
		};
	}
	return null;
}
