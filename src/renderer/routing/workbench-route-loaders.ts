import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import {
	getPreferredSession,
	loadWorkbenchShellData,
	resolveWorkspaceNavigationSelection,
} from '@/renderer/lib/workbench';
import { readStoredWorkspaceSelection } from '@/renderer/state/workspace';
import type {
	ProjectRouteParams,
	WorkbenchRouteLoaderData,
	WorkspaceChatRouteParams,
	WorkspaceRouteLoaderData,
	WorkspaceRouteParams,
} from '@/renderer/types/routing';
import type {
	ProjectShellModel,
	WorkbenchRouteSearch,
} from '@/renderer/types/workbench';

const WORKSPACE_SEARCH_KEYS = new Set(['dock', 'review']);
const LEGACY_CHAT_SEARCH_KEY = 'chat';

interface WorkbenchParentRouteMatch {
	loaderData?: WorkbenchRouteLoaderData;
}

interface WorkspaceParentRouteMatch {
	loaderData?: WorkspaceRouteLoaderData;
}

export function loadWorkbenchRouteData(
	queryClient: QueryClient,
): Promise<WorkbenchRouteLoaderData> {
	return loadWorkbenchShellData(queryClient);
}

/**
 * Forwards the `/_workbench` loader data through the pathless `_shell` layout.
 *
 * `_shell` sits between `/_workbench` (which loads the data) and the
 * project/workspace routes, and `parentMatchPromise` only resolves to the
 * immediate parent match. Without this pass-through, `_shell`'s `loaderData`
 * would be `undefined`, so every descendant loader would read `undefined` from
 * its parent and bail out before running any redirect. Keep this loader in
 * place whenever a route under `_shell` reads workbench data from its parent.
 */
export async function loadShellWorkbenchRoute({
	parentMatchPromise,
}: {
	parentMatchPromise: Promise<WorkbenchParentRouteMatch>;
}): Promise<WorkbenchRouteLoaderData | undefined> {
	const parentMatch = await parentMatchPromise;

	return parentMatch.loaderData;
}

export async function loadProjectWorkbenchRoute({
	parentMatchPromise,
	params,
}: {
	parentMatchPromise: Promise<WorkbenchParentRouteMatch>;
	params: ProjectRouteParams;
}): Promise<WorkbenchRouteLoaderData | undefined> {
	const parentMatch = await parentMatchPromise;
	const loaderData = parentMatch.loaderData;

	if (!loaderData) {
		return undefined;
	}

	if (loaderData.projects.some((project) => project.id === params.projectId)) {
		return loaderData;
	}

	const fallbackSelection = resolveFallbackWorkspaceSelection(
		loaderData.projects,
	);

	if (fallbackSelection) {
		throw redirectToWorkspaceSelection(fallbackSelection);
	}

	return loaderData;
}

export async function loadWorkspaceWorkbenchRoute({
	parentMatchPromise,
	params,
	rawSearch,
	search,
}: {
	parentMatchPromise: Promise<WorkbenchParentRouteMatch>;
	params: WorkspaceRouteParams;
	rawSearch: Record<string, unknown>;
	search: WorkbenchRouteSearch;
}): Promise<WorkspaceRouteLoaderData | undefined> {
	const parentMatch = await parentMatchPromise;
	const loaderData = parentMatch.loaderData;

	if (!loaderData) {
		return undefined;
	}

	const currentSelection = resolveWorkspaceNavigationSelection({
		projects: loaderData.projects,
		routeProjectId: params.projectId,
		routeWorkspaceId: params.workspaceId,
	});
	const fallbackSelection = resolveFallbackWorkspaceSelection(
		loaderData.projects,
	);

	if (!currentSelection && fallbackSelection) {
		throw redirectToWorkspaceSelection(fallbackSelection);
	}

	if (!currentSelection) {
		return undefined;
	}

	const legacyChatId = getStringSearchValue(rawSearch, LEGACY_CHAT_SEARCH_KEY);

	if (legacyChatId || Object.hasOwn(rawSearch, LEGACY_CHAT_SEARCH_KEY)) {
		throw redirectToWorkspaceChat({
			chatId: getPreferredSession(currentSelection.workspace, legacyChatId).id,
			projectId: currentSelection.project.id,
			search,
			workspaceId: currentSelection.workspace.id,
		});
	}

	return {
		project: currentSelection.project,
		workspace: currentSelection.workspace,
	};
}

export async function loadWorkspaceIndexRoute({
	parentMatchPromise,
	params,
	search,
}: {
	parentMatchPromise: Promise<WorkspaceParentRouteMatch>;
	params: WorkspaceRouteParams;
	search: WorkbenchRouteSearch;
}): Promise<void> {
	const parentMatch = await parentMatchPromise;
	const workspaceData = parentMatch.loaderData;

	if (!workspaceData) {
		return;
	}

	throw redirectToWorkspaceChat({
		chatId: getPreferredSession(workspaceData.workspace).id,
		projectId: params.projectId,
		search,
		workspaceId: params.workspaceId,
	});
}

export async function loadWorkspaceChatRoute({
	parentMatchPromise,
	params,
	rawSearch,
	search,
}: {
	parentMatchPromise: Promise<WorkspaceParentRouteMatch>;
	params: WorkspaceChatRouteParams;
	rawSearch: Record<string, unknown>;
	search: WorkbenchRouteSearch;
}): Promise<void> {
	const parentMatch = await parentMatchPromise;
	const workspaceData = parentMatch.loaderData;

	if (!workspaceData) {
		return;
	}

	const activeSession = getPreferredSession(
		workspaceData.workspace,
		params.chatId,
	);

	if (
		params.chatId !== activeSession.id ||
		shouldRedirectToCanonicalWorkspaceSearch(rawSearch, search)
	) {
		throw redirectToWorkspaceChat({
			chatId: activeSession.id,
			projectId: params.projectId,
			search,
			workspaceId: params.workspaceId,
		});
	}
}

function resolveFallbackWorkspaceSelection(projects: ProjectShellModel[]) {
	return resolveWorkspaceNavigationSelection({
		projects,
		storedSelection: readStoredWorkspaceSelection(),
	});
}

function redirectToWorkspaceSelection(
	selection: NonNullable<
		ReturnType<typeof resolveWorkspaceNavigationSelection>
	>,
) {
	return redirect({
		params: {
			chatId: getPreferredSession(selection.workspace).id,
			projectId: selection.project.id,
			workspaceId: selection.workspace.id,
		},
		replace: true,
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
}

function redirectToWorkspaceChat({
	chatId,
	projectId,
	search,
	workspaceId,
}: WorkspaceRouteParams & {
	chatId: string;
	search: WorkbenchRouteSearch;
}) {
	return redirect({
		params: {
			chatId,
			projectId,
			workspaceId,
		},
		replace: true,
		search,
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
}

function shouldRedirectToCanonicalWorkspaceSearch(
	rawSearch: Record<string, unknown>,
	search: WorkbenchRouteSearch,
) {
	return (
		hasUnknownWorkspaceSearch(rawSearch) ||
		isNonCanonicalSearchValue(rawSearch, 'dock', search.dock) ||
		isNonCanonicalSearchValue(rawSearch, 'review', search.review)
	);
}

function hasUnknownWorkspaceSearch(search: Record<string, unknown>) {
	return Object.keys(search).some((key) => !WORKSPACE_SEARCH_KEYS.has(key));
}

function isNonCanonicalSearchValue(
	rawSearch: Record<string, unknown>,
	key: 'dock' | 'review',
	value: string | undefined,
) {
	return Object.hasOwn(rawSearch, key) && rawSearch[key] !== value;
}

function getStringSearchValue(search: Record<string, unknown>, key: string) {
	const value = search[key];

	return typeof value === 'string' ? value : undefined;
}
