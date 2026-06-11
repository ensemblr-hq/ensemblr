import { createFileRoute } from '@tanstack/react-router';

import { LinearIssueList } from '@/renderer/components/linear/issue-list';
import { LinearConnectionGate } from '@/renderer/components/linear/linear-connection-gate';

export const Route = createFileRoute('/_workbench/_shell/linear/')({
	component: LinearBrowseRoute,
	staticData: {
		workbenchView: 'linear',
	},
});

/** Linear issue browse view (list + search + filters). */
function LinearBrowseRoute() {
	return (
		<main className='flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-5'>
			<div className='mx-auto flex w-full max-w-3xl flex-1 flex-col'>
				<LinearConnectionGate>
					<LinearIssueList />
				</LinearConnectionGate>
			</div>
		</main>
	);
}
