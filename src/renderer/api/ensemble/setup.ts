import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation/route-profiler';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

/** Query options for the renderer-side setup-diagnostics snapshot. */
export const setupDiagnosticsQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:setup-diagnostics', usesDatabase: true },
			() => getEnsembleApi().setupDiagnostics(),
		),
	queryKey: ensembleQueryKeys.setupDiagnostics(),
	staleTime: 2000,
});
