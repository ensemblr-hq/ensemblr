import { createFileRoute } from '@tanstack/react-router';

import { LinearIssueDetail } from '@/renderer/components/linear/issue-detail';
import { LinearConnectionGate } from '@/renderer/components/linear/linear-connection-gate';

/** Linear issue detail route; renders the issue named by the `issueId` route param. */
export const Route = createFileRoute('/_workbench/_shell/linear/$issueId')({
	component: LinearIssueDetailRoute,
	staticData: {
		workbenchView: 'linear',
	},
});

/**
 * Linear issue detail view (metadata, description, comments). The page owns its
 * own scrolling so the command bar can stay fixed above the body.
 */
function LinearIssueDetailRoute() {
	const { issueId } = Route.useParams();

	return (
		<main className='flex min-w-0 flex-1 flex-col overflow-hidden'>
			<LinearConnectionGate>
				<LinearIssueDetail issueId={issueId} />
			</LinearConnectionGate>
		</main>
	);
}
