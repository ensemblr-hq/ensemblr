import type { WorkbenchStaticNavigationTarget } from '@/renderer/types/workbench-shell';

/** The set of static TanStack Router `to` paths reachable from the workbench chrome. */
type WorkbenchStaticRouteTo =
	| '/dashboard'
	| '/history'
	| '/settings'
	| '/settings/repo/$repoId/environment';

/** A resolved static route: a `to` path plus optional route params. */
interface WorkbenchStaticRouteSpec {
	to: WorkbenchStaticRouteTo;
	params?: Record<string, string>;
}

const literalRouteByTarget: Record<
	Exclude<WorkbenchStaticNavigationTarget, { kind: string }>,
	WorkbenchStaticRouteTo
> = {
	dashboard: '/dashboard',
	history: '/history',
	settings: '/settings',
};

/**
 * Maps a workbench navigation target to its TanStack Router link spec.
 * @param target - Static target enum value or discriminated variant.
 * @returns A `to` path with optional params, ready for `Link` / `navigate`.
 */
export function getWorkbenchStaticRoute(
	target: WorkbenchStaticNavigationTarget,
): WorkbenchStaticRouteSpec {
	if (typeof target !== 'string') {
		if (target.kind === 'repo-settings') {
			return {
				params: { repoId: target.repoId },
				to: '/settings/repo/$repoId/environment',
			};
		}
		throw new Error(
			`Unknown static navigation variant: ${JSON.stringify(target)}`,
		);
	}
	return { to: literalRouteByTarget[target] };
}
