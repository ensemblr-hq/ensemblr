import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation/route-profiler';
import type { EnsembleApi } from '@/shared/ipc';

export const ensembleQueryKeys = {
	all: ['ensemble'] as const,
	environmentVariables: () =>
		[...ensembleQueryKeys.all, 'environment-variables'] as const,
	health: () => [...ensembleQueryKeys.all, 'health'] as const,
	repositoryWorkspaceNavigation: () =>
		[...ensembleQueryKeys.all, 'repository-workspace-navigation'] as const,
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

export function isEnsembleApiAvailable(): boolean {
	return typeof window !== 'undefined' && Boolean(window.ensemble);
}

export const healthQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:health', usesDatabase: true },
			() => getEnsembleApi().health(),
		),
	queryKey: ensembleQueryKeys.health(),
	staleTime: 5000,
});

export const environmentVariablesQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:environment-variables', usesDatabase: false },
			() => getEnsembleApi().environmentVariables(),
		),
	queryKey: ensembleQueryKeys.environmentVariables(),
	staleTime: 5000,
});

export const repositoryWorkspaceNavigationQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{
				channel: 'ensemble:repository-workspace-navigation',
				usesDatabase: true,
			},
			() => getEnsembleApi().repositoryWorkspaceNavigation(),
		),
	queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
	staleTime: 2000,
});

export const setupDiagnosticsQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:setup-diagnostics', usesDatabase: true },
			() => getEnsembleApi().setupDiagnostics(),
		),
	queryKey: ensembleQueryKeys.setupDiagnostics(),
	staleTime: 2000,
});
