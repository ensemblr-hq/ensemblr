import { createFileRoute, redirect } from '@tanstack/react-router';

/** Index route for a repository's settings; redirects to that repo's Environment page, preserving the `repoId` path param. */
export const Route = createFileRoute('/_workbench/settings/repo/$repoId/')({
	/** Redirects the bare repo-settings path to the repo's Environment page, carrying the `repoId` param through. */
	beforeLoad: ({ params }) => {
		throw redirect({
			params,
			replace: true,
			to: '/settings/repo/$repoId/environment',
		});
	},
});
