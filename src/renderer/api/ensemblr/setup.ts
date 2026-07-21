import { type Query, queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc/contracts/setup';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';
import {
	advanceSetupDiagnosticsPoll,
	initialSetupDiagnosticsPollState,
	type SetupDiagnosticsPollState,
} from './setup-diagnostics-poll';

// Module-scoped so the poll survives the query's mount/unmount churn; each
// `refetchInterval` evaluation advances it purely via `advanceSetupDiagnosticsPoll`.
let setupDiagnosticsPollState: SetupDiagnosticsPollState =
	initialSetupDiagnosticsPollState();

/**
 * Drives the bounded self-healing poll for the setup-diagnostics query. A boot
 * probe can report blocked while a dependency (notably the Pi RPC smoke check)
 * is still warming up; without revalidation that stale failure sticks until the
 * user opens the Diagnostics screen. Polls until `ready`, then stops. The
 * ceiling is charged per completed fetch (`dataUpdateCount + fetchFailureCount`)
 * rather than per evaluation, so extra re-evaluations between fetches can never
 * shrink the settling window.
 * @param query - The active setup-diagnostics query.
 * @returns The poll interval in ms while settling, or `false` once ready/capped.
 */
function getSetupDiagnosticsRefetchInterval(
	query: Query<SetupDiagnosticsSnapshot>,
): number | false {
	const fetchCount =
		query.state.dataUpdateCount + query.state.fetchFailureCount;
	const { intervalMs, state } = advanceSetupDiagnosticsPoll(
		query.state.data?.status,
		fetchCount,
		setupDiagnosticsPollState,
	);
	setupDiagnosticsPollState = state;
	return intervalMs;
}

/** Query options for the renderer-side setup-diagnostics snapshot. */
export const setupDiagnosticsQuery = queryOptions({
	/** Fetches the setup-diagnostics snapshot over the setup-diagnostics IPC channel. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:setup-diagnostics', usesDatabase: true },
			() => getEnsemblrApi().setupDiagnostics(),
		),
	queryKey: ensemblrQueryKeys.setupDiagnostics(),
	refetchInterval: getSetupDiagnosticsRefetchInterval,
	staleTime: 2000,
});
