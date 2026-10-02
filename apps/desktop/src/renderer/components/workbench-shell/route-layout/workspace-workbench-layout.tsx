import {
	getRouteApi,
	useChildMatches,
	useNavigate,
} from '@tanstack/react-router';
import { useLayoutEffect } from 'react';

import { useRouteProfilerMount } from '@/renderer/lib/instrumentation';
import {
	findWorkspaceNavigationSelection,
	getStringRouteParam,
} from '@/renderer/lib/workbench';

import { useWorkbenchLayoutRouteModel } from '../shell-contexts';
import { WorkspaceRouteContent } from './workspace-route-content';

const workspaceRouteApi = getRouteApi(
	'/_workbench/_shell/projects/$projectId/workspaces/$workspaceId',
);

/** Layout route for `/projects/:projectId/workspaces/:workspaceId`. */
export function WorkspaceWorkbenchLayout() {
	useRouteProfilerMount('WorkspaceWorkbenchLayout');

	const model = useWorkbenchLayoutRouteModel();
	const params = workspaceRouteApi.useParams();
	const search = workspaceRouteApi.useSearch();
	const navigate = useNavigate();
	// Only the routed workspace, never the shell's held selection as a fallback.
	// The shell resolves that from its own router subscription, so while an
	// archive is tearing this workspace down it can already name a sibling — and
	// substituting it rendered that sibling's whole workspace view under this
	// URL, with a chat id `useActiveWorkspaceChatId` then refused as belonging to
	// another workspace, which is the pairing that overwrites what the sibling
	// remembered. A workspace the nav data no longer holds is gone; the redirect
	// below is the answer to that, not a stand-in workspace.
	const selection = findWorkspaceNavigationSelection(
		model.displayProjects,
		params.projectId,
		params.workspaceId,
	);
	const chatId = useActiveWorkspaceChatId(selection?.workspace.id);
	const isSelectionMissing = !selection;

	// THE ARCHIVE/DELETE FREEZE LIVED HERE. Do not "simplify" this effect back
	// into `<Navigate replace to='/' />` — it looks idiomatic and twice survived
	// review, but `<Navigate>` re-fires navigate() on every render (fresh JSX
	// props identity), each navigate() synchronously re-renders this
	// still-mounted layout through router-state notifications, and every restart
	// supersedes the pending `/` transition — the index loader never runs and
	// the renderer live-locks with no error (measured: 1,524 renders in ~4s,
	// zero loader entries). Keying one imperative navigate() on a boolean fires
	// it exactly once per missing-selection episode; loadWorkspaceWorkbenchRoute
	// already covers a workspace missing at load time. Regression test:
	// tests/renderer/workspace-workbench-layout-redirect.test.tsx
	useLayoutEffect(() => {
		if (isSelectionMissing) {
			navigate({ replace: true, to: '/' });
		}
	}, [isSelectionMissing, navigate]);

	if (!selection) {
		// The index loader keeps Welcome when no active workspace remains, so
		// there is no redirect back here.
		return null;
	}

	return (
		<WorkspaceRouteContent
			chatId={chatId}
			search={search}
			selection={selection}
		/>
	);
}

/**
 * Extracts the `$chatId` URL param when the active route exposes it, ignoring
 * any child match that belongs to a different workspace than the one this
 * layout renders. The workspace id and the chat id arrive on two independent
 * router subscriptions and a pending transition can surface the incoming
 * workspace's chat beside the outgoing workspace's model; that pairing makes
 * the route substitute the workspace's first tab and overwrite its remembered
 * one, so a chat id is only trusted when its own match agrees on the workspace.
 *
 * Selects the primitive id rather than a params array — this is the second
 * half of the archive/delete freeze fix (see the effect in
 * {@link WorkspaceWorkbenchLayout}). The selector runs on EVERY router-state
 * notification, including the pending-transition churn a redirect produces,
 * and its result is compared by identity. The old `matches.map(...)` returned
 * a brand-new array each call, so this layout re-rendered for router activity
 * that changed nothing — and every one of those re-renders re-armed the old
 * `<Navigate>`'s layout effect, feeding the synchronous navigate/render loop
 * that froze the app. A string (or undefined) compares equal to itself, so
 * the layout now re-renders only when the chat id actually changes.
 * @param workspaceId - Workspace the layout renders, or undefined when unresolved
 * @returns The routed chat id for that workspace, or undefined
 */
function useActiveWorkspaceChatId(workspaceId: string | undefined) {
	return useChildMatches({
		select: (matches): string | undefined => {
			for (let index = matches.length - 1; index >= 0; index -= 1) {
				const matchParams = matches[index].params as unknown as Record<
					string,
					unknown
				>;

				if (getStringRouteParam(matchParams, 'workspaceId') !== workspaceId) {
					continue;
				}

				const chatId = getStringRouteParam(matchParams, 'chatId');

				if (chatId) {
					return chatId;
				}
			}

			return undefined;
		},
	});
}
