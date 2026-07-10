import { createFileRoute, redirect } from '@tanstack/react-router';

/** Index route for the settings section; immediately redirects to the General settings page. */
export const Route = createFileRoute('/_workbench/settings/')({
	/** Redirects the bare settings path to the General settings page. */
	beforeLoad: () => {
		throw redirect({ to: '/settings/general' });
	},
});
