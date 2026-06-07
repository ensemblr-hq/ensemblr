import { createFileRoute } from '@tanstack/react-router';

import { DashboardWelcome } from '@/renderer/components/dashboard-welcome';
import { defaultRecentGithubRepos } from '@/renderer/mocks/workbench';

export const Route = createFileRoute('/_workbench/_shell/')({
	component: WelcomeRoute,
	staticData: {
		workbenchView: 'welcome',
	},
});

/** Welcome view shown when no project is selected. */
function WelcomeRoute() {
	return <DashboardWelcome recentGithubRepos={defaultRecentGithubRepos} />;
}
