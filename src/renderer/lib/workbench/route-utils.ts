import type {
	WorkbenchChildMatch,
	WorkbenchShellRouteState,
} from '@/renderer/types/components';

import { isWorkbenchActiveView } from './active-view';

/**
 * Separator joining the shell's route state into one string. A NUL can never
 * occur in a route param, so nothing packed can forge a field boundary.
 */
const SHELL_ROUTE_STATE_SEPARATOR = '\u0000';

/** Safely extracts a string route param from a router match. */
export function getStringRouteParam(
	params: Record<string, unknown> | undefined,
	key: string,
) {
	const value = params?.[key];

	return typeof value === 'string' ? value : undefined;
}

/** Extracts the `workbenchView` value from a route's `staticData` payload. */
export function getWorkbenchStaticView(staticData: unknown) {
	if (typeof staticData !== 'object' || staticData === null) {
		return undefined;
	}

	return 'workbenchView' in staticData ? staticData.workbenchView : undefined;
}

/**
 * Packs the workbench shell's active view and routed ids into one string.
 *
 * A string rather than the object it describes, because this runs as a TanStack
 * Router `select` and the router leaves `defaultStructuralSharing` off: a
 * selector result is compared by shallow equality, so an object or array literal
 * is a fresh identity on EVERY router-state notification — including the
 * pending-transition churn a redirect produces — and re-renders the entire shell
 * for router activity that changed nothing. That storm is the shell-level half
 * of the archive/delete freeze; `useActiveWorkspaceChatId` in
 * `workspace-workbench-layout.tsx` carries the same fix for the same reason. A
 * string compares equal to itself, so the shell re-renders only when the view or
 * the routed ids actually move.
 * @param matches - Child matches below the workbench shell, innermost last
 * @returns The packed route state, read back by {@link unpackWorkbenchShellRouteState}
 */
export function packWorkbenchShellRouteState(
	matches: readonly WorkbenchChildMatch[],
): string {
	const view = resolveWorkbenchActiveView(matches);

	if (view !== 'workspace') {
		return view;
	}

	const workspaceMatch = findLastMatch(
		matches,
		(match) =>
			getStringRouteParam(match.params, 'projectId') !== undefined &&
			getStringRouteParam(match.params, 'workspaceId') !== undefined,
	);

	return [
		view,
		getStringRouteParam(workspaceMatch?.params, 'projectId') ?? '',
		getStringRouteParam(workspaceMatch?.params, 'workspaceId') ?? '',
	].join(SHELL_ROUTE_STATE_SEPARATOR);
}

/**
 * Reads a string packed by {@link packWorkbenchShellRouteState} back into the
 * route state the shell renders from.
 * @param packed - The packed route state
 * @returns The active view plus the routed project and workspace ids
 */
export function unpackWorkbenchShellRouteState(
	packed: string,
): WorkbenchShellRouteState {
	const [view, routeProjectId, routeWorkspaceId] = packed.split(
		SHELL_ROUTE_STATE_SEPARATOR,
	);

	if (view !== 'workspace') {
		return { view: isWorkbenchActiveView(view) ? view : 'welcome' };
	}

	return {
		routeProjectId: routeProjectId || undefined,
		routeWorkspaceId: routeWorkspaceId || undefined,
		view,
	};
}

/**
 * Resolves the innermost child match that names a workbench view, which is the
 * view the shell is showing.
 * @param matches - Child matches below the workbench shell, innermost last
 * @returns The active view, defaulting to Welcome when no match names one
 */
function resolveWorkbenchActiveView(matches: readonly WorkbenchChildMatch[]) {
	const viewMatch = findLastMatch(matches, (match) =>
		isWorkbenchActiveView(getWorkbenchStaticView(match.staticData)),
	);
	const view = getWorkbenchStaticView(viewMatch?.staticData);

	return isWorkbenchActiveView(view) ? view : 'welcome';
}

/**
 * Returns the innermost match satisfying a predicate. Hand-rolled because the
 * tsconfig targets ES2022, which predates `Array.prototype.findLast`.
 * @param matches - Child matches below the workbench shell, innermost last
 * @param predicate - Test each match has to pass
 * @returns The innermost passing match, or undefined when none does
 */
function findLastMatch(
	matches: readonly WorkbenchChildMatch[],
	predicate: (match: WorkbenchChildMatch) => boolean,
): WorkbenchChildMatch | undefined {
	for (let index = matches.length - 1; index >= 0; index -= 1) {
		if (predicate(matches[index])) {
			return matches[index];
		}
	}

	return undefined;
}
