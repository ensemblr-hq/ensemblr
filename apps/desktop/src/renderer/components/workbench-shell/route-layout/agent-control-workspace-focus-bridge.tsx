import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { invalidateWorkspaceListViews } from '@/renderer/api/ensemblr';
import { useWorkbenchLayoutRouteModelOptional } from '@/renderer/components/workbench-shell/shell-contexts';
import { useNavigateToLastUnread } from '@/renderer/hooks/workbench-shell/composer/use-navigate-to-last-unread';
import { useAgentControlFocus } from '@/renderer/hooks/workbench-shell/route-layout/use-agent-control-focus';
import { findWorkspaceSelectionById } from '@/renderer/lib/workbench';
import type { WorkbenchLayoutModel } from '@/renderer/types/workbench-shell';

/**
 * How long a held request waits for its workspace to show up in the tree.
 *
 * Two of the shell's 15-second polls, so a create that is merely slow still
 * lands. Past that the workspace is not coming — it failed after the broadcast,
 * or it is archived — and the request has to die rather than sit armed: the user
 * has moved on by then, and a jump fired off a request they no longer remember
 * making reads as the app losing their place.
 */
const FOCUS_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Whether the shell's tree already lists a workspace — which decides both
 * whether a focus request can land right now and whether the tree is worth
 * asking for again.
 * @param layoutModel - The shell's layout model, absent outside the shell.
 * @param workspaceId - Workspace the focus request names.
 * @returns True when the tree holds it.
 */
function listsWorkspace(
	layoutModel: WorkbenchLayoutModel | null,
	workspaceId: string,
): boolean {
	return (
		layoutModel !== null &&
		findWorkspaceSelectionById(layoutModel.displayProjects, workspaceId) !==
			null
	);
}

/**
 * Drains the one focus target that crosses workspaces: `{ kind: 'workspace' }`,
 * which the Concierge sends to move the route to a workspace nobody is showing.
 *
 * Renders nothing, and lives at the shell rather than inside the workspace
 * route, because the workspace-scoped applier only ever runs for the workspace
 * already on screen — which is precisely the one this target is never about. The
 * jump reuses `useNavigateToLastUnread`, which already resolves a workspace to
 * its preferred chat and handles a workspace this window has never opened.
 *
 * A request for a workspace the tree does not list yet is held rather than
 * dropped, because the Concierge cuts a workspace and focuses it in the same
 * breath: the shell's tree is a query that refetches on a 15-second poll, so at
 * that moment the workspace it names is usually not in the tree at all and the
 * jump would find nothing to navigate to. Asking for the tree afresh and waiting
 * for the workspace to appear in it turns that race into a beat, and
 * {@link FOCUS_REQUEST_TIMEOUT_MS} is how long the beat may last.
 */
export function AgentControlWorkspaceFocusBridge() {
	const navigateToChat = useNavigateToLastUnread();
	const queryClient = useQueryClient();
	const layoutModel = useWorkbenchLayoutRouteModelOptional();
	const [requestedWorkspaceId, setRequestedWorkspaceId] = useState<
		string | null
	>(null);
	useAgentControlFocus((payload) => {
		if (payload.target.kind !== 'workspace') {
			return;
		}
		setRequestedWorkspaceId(payload.workspaceId);
		if (listsWorkspace(layoutModel, payload.workspaceId)) {
			return;
		}
		void invalidateWorkspaceListViews(queryClient).catch(() => undefined);
	});

	useEffect(() => {
		if (
			requestedWorkspaceId === null ||
			!listsWorkspace(layoutModel, requestedWorkspaceId)
		) {
			return;
		}
		setRequestedWorkspaceId(null);
		void navigateToChat({ workspaceId: requestedWorkspaceId });
	}, [layoutModel, navigateToChat, requestedWorkspaceId]);

	useEffect(() => {
		if (requestedWorkspaceId === null) {
			return;
		}
		const expiry = setTimeout(
			() => setRequestedWorkspaceId(null),
			FOCUS_REQUEST_TIMEOUT_MS,
		);
		return () => clearTimeout(expiry);
	}, [requestedWorkspaceId]);

	return null;
}
