import { type ErrorComponentProps, Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { WorkbenchEmptyStateShell } from '@/renderer/components/workbench-empty-state';
import { getErrorMessage } from '@/renderer/lib/error';
import { getWorkbenchStaticRoute } from '@/renderer/lib/workbench';
import type { NavigationContextValue } from '@/renderer/types/contexts';
import type {
	WorkbenchHealth,
	WorkbenchStaticNavigationTarget,
} from '@/renderer/types/workbench-shell';

interface BoundaryCopy {
	detail: string;
	title: string;
}

const BOUNDARY_NAVIGATION: NavigationContextValue = {
	renderStaticLink,
	renderWorkspaceLink: undefined,
};

function renderBoundary(emptyState: BoundaryCopy, health: WorkbenchHealth) {
	return (
		<WorkbenchEmptyStateShell
			activeView='dashboard'
			emptyState={emptyState}
			health={health}
			navigation={BOUNDARY_NAVIGATION}
			onStaticNavigationSelect={noop}
			onWorkspaceSelect={noop}
			projects={[]}
		/>
	);
}

/** TanStack Router `pendingComponent` rendered while a route loader is in-flight. */
export function WorkbenchRoutePending() {
	return renderBoundary(
		{
			detail: 'Ensemblr is reading repositories and workspaces from SQLite.',
			title: 'Loading repositories',
		},
		{
			detail: 'Renderer route data is loading.',
			label: 'Loading',
			state: 'pending',
		},
	);
}

/** TanStack Router `errorComponent` rendered when a route loader throws. */
export function WorkbenchRouteError({ error }: ErrorComponentProps) {
	return renderBoundary(
		{
			detail: getErrorMessage(error) ?? 'Route data failed to load.',
			title: 'Route unavailable',
		},
		{
			detail: 'TanStack Router caught a route-level failure.',
			label: 'Route error',
			state: 'unavailable',
		},
	);
}

/** TanStack Router `notFoundComponent` rendered for unmatched routes. */
export function WorkbenchRouteNotFound() {
	return renderBoundary(
		{
			detail: 'The requested route does not exist.',
			title: 'Page not found',
		},
		{
			detail: 'Choose another route from the workspace navigation.',
			label: 'Not found',
			state: 'unavailable',
		},
	);
}

/** Wraps boundary-mode static navigation items with a router `Link`. */
function renderStaticLink(
	target: WorkbenchStaticNavigationTarget,
	children: ReactElement,
) {
	const spec = getWorkbenchStaticRoute(target);
	return (
		<Link params={spec.params} preload='intent' to={spec.to}>
			{children}
		</Link>
	);
}

const noop = () => undefined;
