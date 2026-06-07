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

/** Subset of the workbench parent match consumed by descendant loaders. */
interface WorkbenchParentRouteMatch {
	loaderData?: WorkbenchRouteLoaderData;
}

/** Subset of the workspace parent match consumed by descendant loaders. */
interface WorkspaceParentRouteMatch {
	loaderData?: WorkspaceRouteLoaderData;
}

/**
 * Loader for the `/_workbench` route — fetches every dataset the shell needs.
 * @param queryClient - Shared TanStack Query client.
 * @returns The workbench loader data.
 */
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

/**
 * Loader for project routes. Redirects to the stored/fallback workspace when
 * the URL project id is not present in the loaded data.
 * @param input - Parent match plus URL params.
 * @returns Parent loader data, or redirects.
 */
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

/**
 * Loader for workspace routes. Resolves the (project, workspace) selection,
 * migrates the legacy `?chat=` query into the canonical `/chats/:chatId` route,
 * and redirects to a fallback when the URL workspace is missing.
 * @param input - Parent match, URL params, parsed and raw search.
 * @returns The workspace loader data, or redirects.
 */
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

/**
 * Loader for the workspace index route — redirects to the preferred chat.
 * @param input - Parent match, URL params, canonical search.
 */
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

/**
 * Loader for the workspace chat route. Redirects to the canonical chat id and
 * search shape when the URL drifts from the workspace's preferred session.
 * @param input - Parent match, URL params, parsed and raw search.
 */
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

/** Resolves the fallback workspace selection from persisted/first-available. */
function resolveFallbackWorkspaceSelection(projects: ProjectShellModel[]) {
	return resolveWorkspaceNavigationSelection({
		projects,
		storedSelection: readStoredWorkspaceSelection(),
	});
}

/** Builds a TanStack Router redirect into the chosen workspace's chat route. */
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

/** Builds a TanStack Router redirect into a canonical chat route. */
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

/** True when the URL search drifts from the canonical {@link WorkbenchRouteSearch}. */
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

/** True when the search includes a key outside the canonical workspace set. */
function hasUnknownWorkspaceSearch(search: Record<string, unknown>) {
	return Object.keys(search).some((key) => !WORKSPACE_SEARCH_KEYS.has(key));
}

/** True when the raw search value for `key` does not match the canonical value. */
function isNonCanonicalSearchValue(
	rawSearch: Record<string, unknown>,
	key: 'dock' | 'review',
	value: string | undefined,
) {
	return Object.hasOwn(rawSearch, key) && rawSearch[key] !== value;
}

/** Returns the string-valued search param at `key`, or `undefined`. */
function getStringSearchValue(search: Record<string, unknown>, key: string) {
	const value = search[key];

	return typeof value === 'string' ? value : undefined;
}
