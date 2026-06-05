import { queryOptions } from '@tanstack/react-query';

import type { EnsembleApi } from '@/shared/ipc';

export const ensembleQueryKeys = {
	all: ['ensemble'] as const,
	environmentVariables: () =>
		[...ensembleQueryKeys.all, 'environment-variables'] as const,
	health: () => [...ensembleQueryKeys.all, 'health'] as const,
	setupDiagnostics: () =>
		[...ensembleQueryKeys.all, 'setup-diagnostics'] as const,
};

function getEnsembleApi(): EnsembleApi {
	const ensemble = window.ensemble;

	if (!ensemble) {
		throw new Error('Electron preload bridge is unavailable in this context.');
	}

	return ensemble;
}

export const healthQuery = queryOptions({
	queryFn: () => getEnsembleApi().health(),
	queryKey: ensembleQueryKeys.health(),
	staleTime: 5000,
});

export const environmentVariablesQuery = queryOptions({
	queryFn: () => getEnsembleApi().environmentVariables(),
	queryKey: ensembleQueryKeys.environmentVariables(),
	staleTime: 5000,
});

export const setupDiagnosticsQuery = queryOptions({
	queryFn: () => getEnsembleApi().setupDiagnostics(),
	queryKey: ensembleQueryKeys.setupDiagnostics(),
	staleTime: 2000,
});
