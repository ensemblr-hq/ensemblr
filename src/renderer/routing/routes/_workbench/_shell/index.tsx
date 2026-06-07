import { createFileRoute } from '@tanstack/react-router';

import { Welcome } from '@/renderer/components/welcome';
import { defaultRecentGithubRepos } from '@/renderer/mocks/workbench';

export const Route = createFileRoute('/_workbench/_shell/')({
	component: WelcomeRoute,
	staticData: {
		workbenchView: 'welcome',
	},
});

/** Welcome view shown when no project is selected. */
function WelcomeRoute() {
	return <Welcome recentGithubRepos={defaultRecentGithubRepos} />;
}
