import { createFileRoute } from '@tanstack/react-router';
import {
	WorkbenchRouteError,
	WorkbenchRouteNotFound,
	WorkbenchRoutePending,
} from '@/renderer/components/workbench-shell/route-boundaries';
import { WorkbenchShellLayout } from '@/renderer/components/workbench-shell/route-layout';
import { loadShellWorkbenchRoute } from '@/renderer/routing/workbench-route-loaders';

/**
 * Shell layout route under `/_workbench`; loads shell-scoped workbench data and
 * renders the persistent workbench chrome around descendant routes.
 */
export const Route = createFileRoute('/_workbench/_shell')({
	component: WorkbenchShellLayout,
	errorComponent: WorkbenchRouteError,
	/** Loads the shell workbench route data, chaining off the parent match. */
	loader: ({ parentMatchPromise }) =>
		loadShellWorkbenchRoute({ parentMatchPromise }),
	notFoundComponent: WorkbenchRouteNotFound,
	pendingComponent: WorkbenchRoutePending,
});
