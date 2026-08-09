import { type ErrorComponentProps, Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkbenchEmptyStateShell } from '@/renderer/components/workbench-empty-state';
import { getErrorMessage } from '@/renderer/lib/error';
import { getWorkbenchStaticRoute } from '@/renderer/lib/workbench';
import type { NavigationContextValue } from '@/renderer/types/contexts';
import type {
	WorkbenchHealth,
	WorkbenchStaticNavigationTarget,
} from '@/renderer/types/workbench-shell';

/** Title and detail text for a route-boundary empty state. */
interface BoundaryCopy {
	detail: string;
	title: string;
}

const BOUNDARY_NAVIGATION: NavigationContextValue = {
	renderStaticLink,
	renderWorkspaceLink: undefined,
};

/**
 * Renders the shared empty-state shell used by every workbench route boundary.
 * @param emptyState - Title and detail copy shown to the user
 * @param health - Health banner describing the boundary condition
 * @returns The rendered empty-state shell element
 */
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
	const { t } = useTranslation();
	return renderBoundary(
		{
			detail: t(
				'errors:route-pending.detail',
				'Ensemblr is reading repositories and workspaces from SQLite.',
			),
			title: t('errors:route-pending.title', 'Loading repositories'),
		},
		{
			detail: t(
				'errors:route-pending.health-detail',
				'Renderer route data is loading.',
			),
			label: t('errors:route-pending.health-label', 'Loading'),
			state: 'pending',
		},
	);
}

/** TanStack Router `errorComponent` rendered when a route loader throws. */
export function WorkbenchRouteError({ error }: ErrorComponentProps) {
	const { t } = useTranslation();
	return renderBoundary(
		{
			detail:
				getErrorMessage(error) ??
				t('errors:route-error.detail', 'Route data failed to load.'),
			title: t('errors:route-error.title', 'Route unavailable'),
		},
		{
			detail: t(
				'errors:route-error.health-detail',
				'TanStack Router caught a route-level failure.',
			),
			label: t('errors:route-error.health-label', 'Route error'),
			state: 'unavailable',
		},
	);
}

/** TanStack Router `notFoundComponent` rendered for unmatched routes. */
export function WorkbenchRouteNotFound() {
	const { t } = useTranslation();
	return renderBoundary(
		{
			detail: t(
				'errors:route-not-found.detail',
				'The requested route does not exist.',
			),
			title: t('errors:route-not-found.title', 'Page not found'),
		},
		{
			detail: t(
				'errors:route-not-found.health-detail',
				'Choose another route from the workspace navigation.',
			),
			label: t('errors:route-not-found.health-label', 'Not found'),
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

/** No-op selection handler for boundary states that offer no navigation. */
const noop = () => undefined;
