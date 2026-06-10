import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

/** Query options for the renderer-side health snapshot. */
export const healthQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:health', usesDatabase: true },
			() => getEnsembleApi().health(),
		),
	queryKey: ensembleQueryKeys.health(),
	staleTime: 5000,
});

/** Query options for the renderer-side environment-variables snapshot. */
export const environmentVariablesQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:environment-variables', usesDatabase: false },
			() => getEnsembleApi().environmentVariables(),
		),
	queryKey: ensembleQueryKeys.environmentVariables(),
	staleTime: 5000,
});
