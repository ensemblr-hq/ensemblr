import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_workbench/settings/repo/$repoId/')({
	beforeLoad: ({ params }) => {
		throw redirect({
			params,
			replace: true,
			to: '/settings/repo/$repoId/environment',
		});
	},
});
