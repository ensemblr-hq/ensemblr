import { createFileRoute } from '@tanstack/react-router';

import { LinearIssueDetail } from '@/renderer/components/linear/issue-detail';
import { LinearConnectionGate } from '@/renderer/components/linear/linear-connection-gate';

export const Route = createFileRoute('/_workbench/_shell/linear/$issueId')({
	component: LinearIssueDetailRoute,
	staticData: {
		workbenchView: 'linear',
	},
});

/** Linear issue detail view (metadata, description, comments). */
function LinearIssueDetailRoute() {
	const { issueId } = Route.useParams();

	return (
		<main className='flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-5'>
			<div className='mx-auto flex w-full max-w-3xl flex-1 flex-col'>
				<LinearConnectionGate>
					<LinearIssueDetail issueId={issueId} />
				</LinearConnectionGate>
			</div>
		</main>
	);
}
