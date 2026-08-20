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
	const chatId = useActiveWorkspaceChatId();
	const navigate = useNavigate();
	const selection =
		findWorkspaceNavigationSelection(
			model.displayProjects,
			params.projectId,
			params.workspaceId,
		) ?? model.displaySelection;
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
 * Extracts the `$chatId` URL param when the active route exposes it.
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
 */
function useActiveWorkspaceChatId() {
	return useChildMatches({
		select: (matches): string | undefined => {
			for (let index = matches.length - 1; index >= 0; index -= 1) {
				const chatId = getStringRouteParam(
					matches[index].params as unknown as Record<string, unknown>,
					'chatId',
				);

				if (chatId) {
					return chatId;
				}
			}

			return undefined;
		},
	});
}
