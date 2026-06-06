import { type ErrorComponentProps, Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { WorkbenchEmptyStateShell } from '@/renderer/components/workbench-empty-state';
import {
	getErrorMessage,
	getWorkbenchStaticRoute,
} from '@/renderer/lib/workbench';
import type { WorkbenchStaticNavigationTarget } from '@/renderer/types/workbench-shell';

export function WorkbenchRoutePending() {
	return (
		<WorkbenchEmptyStateShell
			activeView='dashboard'
			emptyState={{
				detail: 'Ensemble is reading repositories and workspaces from SQLite.',
				title: 'Loading repositories',
			}}
			health={{
				detail: 'Renderer route data is loading.',
				label: 'Loading',
				state: 'pending',
			}}
			onStaticNavigationSelect={noop}
			onWorkspaceSelect={() => undefined}
			projects={[]}
			renderStaticNavigationLink={renderStaticNavigationLink}
		/>
	);
}

export function WorkbenchRouteError({ error }: ErrorComponentProps) {
	return (
		<WorkbenchEmptyStateShell
			activeView='dashboard'
			emptyState={{
				detail: getErrorMessage(error) ?? 'Route data failed to load.',
				title: 'Route unavailable',
			}}
			health={{
				detail: 'TanStack Router caught a route-level failure.',
				label: 'Route error',
				state: 'unavailable',
			}}
			onStaticNavigationSelect={noop}
			onWorkspaceSelect={() => undefined}
			projects={[]}
			renderStaticNavigationLink={renderStaticNavigationLink}
		/>
	);
}

export function WorkbenchRouteNotFound() {
	return (
		<WorkbenchEmptyStateShell
			activeView='dashboard'
			emptyState={{
				detail: 'The requested route does not exist.',
				title: 'Page not found',
			}}
			health={{
				detail: 'Choose another route from the workspace navigation.',
				label: 'Not found',
				state: 'unavailable',
			}}
			onStaticNavigationSelect={noop}
			onWorkspaceSelect={() => undefined}
			projects={[]}
			renderStaticNavigationLink={renderStaticNavigationLink}
		/>
	);
}

function renderStaticNavigationLink(
	target: WorkbenchStaticNavigationTarget,
	children: ReactElement,
) {
	return (
		<Link preload='intent' to={getWorkbenchStaticRoute(target)}>
			{children}
		</Link>
	);
}

const noop = () => undefined;
