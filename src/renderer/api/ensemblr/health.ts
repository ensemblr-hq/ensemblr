import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { CompactDatabaseResult } from '@/shared/ipc/contracts/health';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/** Query options for the renderer-side health snapshot. */
export const healthQuery = queryOptions({
	/** Fetches the health snapshot over IPC with call profiling. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:health', usesDatabase: true },
			() => getEnsemblrApi().health(),
		),
	queryKey: ensemblrQueryKeys.health(),
	staleTime: 5000,
});

/**
 * Runs `VACUUM` against the local database, rewriting the whole file to
 * reclaim pages retention already freed. Blocks the main process for the
 * duration, so the caller should show a pending state and refetch
 * {@link healthQuery} on success to pick up the new size.
 * @returns The size before and after, and how long the rewrite took.
 */
export function compactDatabase(): Promise<CompactDatabaseResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:compact-database', usesDatabase: true },
		() => getEnsemblrApi().compactDatabase(),
	);
}

/** Query options for the renderer-side environment-variables snapshot. */
export const environmentVariablesQuery = queryOptions({
	/** Fetches the environment-variables snapshot over IPC with call profiling. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:environment-variables', usesDatabase: false },
			() => getEnsemblrApi().environmentVariables(),
		),
	queryKey: ensemblrQueryKeys.environmentVariables(),
	staleTime: 5000,
});
