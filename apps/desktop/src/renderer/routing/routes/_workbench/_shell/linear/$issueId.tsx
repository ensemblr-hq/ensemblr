import { createFileRoute } from '@tanstack/react-router';

import { LinearIssueDetail } from '@/renderer/components/linear/issue-detail';
import { LinearIssueDetailHeader } from '@/renderer/components/linear/issue-detail-header';
import { LinearConnectionGate } from '@/renderer/components/linear/linear-connection-gate';
import { ShellScreen } from '@/renderer/components/workbench-shell/shell-screen';

/** Linear issue detail route; renders the issue named by the `issueId` route param. */
export const Route = createFileRoute('/_workbench/_shell/linear/$issueId')({
	component: LinearIssueDetailRoute,
	staticData: {
		workbenchView: 'linear',
	},
});

/**
 * Linear issue detail view (metadata, description, comments). Sits in the shared
 * shell screen, which bounds the page to the viewport so the body scrolls under a
 * command bar that stays put rather than scrolling the whole screen.
 *
 * The command bar renders outside the connection gate: it carries the way back
 * out and the collapsed-sidebar trigger, which have to survive the states where
 * the gate swallows the body — no connected account, or a load still in flight.
 */
function LinearIssueDetailRoute() {
	const { issueId } = Route.useParams();

	return (
		<ShellScreen>
			<LinearIssueDetailHeader issueId={issueId} />
			<LinearConnectionGate>
				<LinearIssueDetail issueId={issueId} />
			</LinearConnectionGate>
		</ShellScreen>
	);
}
