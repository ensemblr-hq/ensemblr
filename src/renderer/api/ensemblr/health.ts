import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/** Query options for the renderer-side health snapshot. */
export const healthQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:health', usesDatabase: true },
			() => getEnsemblrApi().health(),
		),
	queryKey: ensemblrQueryKeys.health(),
	staleTime: 5000,
});

/** Query options for the renderer-side environment-variables snapshot. */
export const environmentVariablesQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:environment-variables', usesDatabase: false },
			() => getEnsemblrApi().environmentVariables(),
		),
	queryKey: ensemblrQueryKeys.environmentVariables(),
	staleTime: 5000,
});
