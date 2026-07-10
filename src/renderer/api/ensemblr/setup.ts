import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/** Query options for the renderer-side setup-diagnostics snapshot. */
export const setupDiagnosticsQuery = queryOptions({
	/** Fetches the setup-diagnostics snapshot over the setup-diagnostics IPC channel. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:setup-diagnostics', usesDatabase: true },
			() => getEnsemblrApi().setupDiagnostics(),
		),
	queryKey: ensemblrQueryKeys.setupDiagnostics(),
	staleTime: 2000,
});
