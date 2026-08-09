import { createFileRoute, redirect } from '@tanstack/react-router';
import { onboardingStatusQuery } from '@/renderer/api/ensemblr';
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
 *
 * Guards first run here rather than on `/_workbench` so `/settings/*` — a
 * sibling of this route, not a descendant — stays reachable while onboarding is
 * outstanding. A wizard remediation that opens settings would otherwise bounce
 * straight back.
 */
export const Route = createFileRoute('/_workbench/_shell')({
	/** Sends a machine that has never finished onboarding to the first-run wizard. */
	beforeLoad: async ({ context }) => {
		const onboarding = await context.queryClient.ensureQueryData(
			onboardingStatusQuery,
		);

		if (!onboarding.completedAt) {
			throw redirect({ to: '/onboarding' });
		}
	},
	component: WorkbenchShellLayout,
	errorComponent: WorkbenchRouteError,
	/** Loads the shell workbench route data, chaining off the parent match. */
	loader: ({ parentMatchPromise }) =>
		loadShellWorkbenchRoute({ parentMatchPromise }),
	notFoundComponent: WorkbenchRouteNotFound,
	pendingComponent: WorkbenchRoutePending,
});
