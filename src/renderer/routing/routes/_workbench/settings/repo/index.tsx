import { createFileRoute, redirect } from '@tanstack/react-router';

const LAST_REPO_STORAGE_KEY = 'ensemblr_pref_active_repo_id';

/**
 * Bare `/settings/repo` redirects to the last-known repo's environment section,
 * or back to user-scope settings when no repo was previously visited.
 * Invalid stored ids are caught downstream by `$repoId.tsx` and shown as not-found.
 */
function readLastRepoId(): string | null {
	try {
		const raw = window.localStorage.getItem(LAST_REPO_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		return typeof parsed === 'string' ? parsed : null;
	} catch {
		return null;
	}
}

/** Index route for repository settings; redirects to the last-visited repo's Environment page, or to General settings when none was visited. */
export const Route = createFileRoute('/_workbench/settings/repo/')({
	/** Redirects the bare repo-settings path to the last-known repo's Environment page, or to General settings when there is none. */
	beforeLoad: () => {
		const lastRepoId = readLastRepoId();
		if (lastRepoId) {
			throw redirect({
				params: { repoId: lastRepoId },
				replace: true,
				to: '/settings/repo/$repoId/environment',
			});
		}
		throw redirect({ replace: true, to: '/settings/general' });
	},
});
