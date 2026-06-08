import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_workbench/settings/')({
	beforeLoad: () => {
		throw redirect({ to: '/settings/general' });
	},
});
