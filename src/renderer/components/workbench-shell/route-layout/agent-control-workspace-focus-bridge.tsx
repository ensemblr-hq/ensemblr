import { useNavigateToLastUnread } from '@/renderer/hooks/workbench-shell/composer/use-navigate-to-last-unread';
import { useAgentControlFocus } from '@/renderer/hooks/workbench-shell/route-layout/use-agent-control-focus';

/**
 * Drains the one focus target that crosses workspaces: `{ kind: 'workspace' }`,
 * which the Concierge sends to move the route to a workspace nobody is showing.
 *
 * Renders nothing, and lives at the shell rather than inside the workspace
 * route, because the workspace-scoped applier only ever runs for the workspace
 * already on screen — which is precisely the one this target is never about. The
 * jump reuses `useNavigateToLastUnread`, which already resolves a workspace to
 * its preferred chat and handles a workspace this window has never opened.
 */
export function AgentControlWorkspaceFocusBridge() {
	const navigateToChat = useNavigateToLastUnread();

	useAgentControlFocus((payload) => {
		if (payload.target.kind !== 'workspace') {
			return;
		}
		void navigateToChat({ workspaceId: payload.workspaceId });
	});

	return null;
}
