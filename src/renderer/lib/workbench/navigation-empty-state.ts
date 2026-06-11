/**
 * Picks the empty-state title and detail surfaced by the workspace navigation
 * sidebar based on loading state, errors and project count.
 * @param input - Loading state, navigation error, project count, setup status.
 * @returns A `{ title, detail }` empty-state copy block.
 */
export function getEmptyStateCopy({
	isLoading,
	navigationError,
	projectCount,
	setupStatus,
}: {
	isLoading: boolean;
	navigationError: string | null;
	projectCount: number;
	setupStatus?: string;
}) {
	if (isLoading) {
		return {
			detail: 'Ensemble is reading repositories and workspaces from SQLite.',
			title: 'Loading repositories',
		};
	}

	if (navigationError) {
		return {
			detail: navigationError,
			title: 'Repository navigation unavailable',
		};
	}

	if (setupStatus !== 'ready') {
		return {
			detail: 'Complete setup checks before creating or opening workspaces.',
			title: 'Setup required',
		};
	}

	if (projectCount > 0) {
		return {
			detail:
				'Repositories are registered, but none have active workspaces yet.',
			title: 'No active workspaces',
		};
	}

	return {
		detail: 'Open or create a repository to populate the workspace navigation.',
		title: 'No repositories yet',
	};
}
