import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation/route-profiler';
import type { EnsembleApi } from '@/shared/ipc';

/** Hierarchical TanStack Query keys for every Ensemble IPC-backed query. */
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

/**
 * Returns the `window.ensemble` bridge, throwing when the preload script did
 * not run (e.g. in unit tests).
 * @returns The {@link EnsembleApi} instance.
 */
function getEnsembleApi(): EnsembleApi {
	const ensemble = window.ensemble;

	if (!ensemble) {
		throw new Error('Electron preload bridge is unavailable in this context.');
	}

	return ensemble;
}

/**
 * Tests whether the preload bridge has been wired into the current window.
 * @returns True when `window.ensemble` is present.
 */
export function isEnsembleApiAvailable(): boolean {
	return typeof window !== 'undefined' && Boolean(window.ensemble);
}

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

/** Query options for the renderer-side repository/workspace navigation snapshot. */
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
