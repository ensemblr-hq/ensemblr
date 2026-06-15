import { hashKey, QueryClient } from '@tanstack/react-query';

import type { ListPiModelsResult } from '@/shared/ipc/contracts/pi-session';
import { writeCachedPiModels } from './ensemble/pi-models-cache';
import { ensembleQueryKeys } from './ensemble-queries';

/** Singleton TanStack Query client for the renderer, with conservative defaults. */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			refetchOnWindowFocus: false,
		},
	},
});

seedQueryCacheFromInitialSnapshot();
persistPiModelsOnUpdate();

/**
 * Seeds the query cache with the navigation/health snapshot the preload script
 * captured synchronously at boot, so the first render does not have to wait on
 * an IPC roundtrip + SQLite read for repository data.
 */
function seedQueryCacheFromInitialSnapshot(): void {
	if (typeof window === 'undefined') {
		return;
	}
	const snapshot = window.ensembleInitialShellSnapshot;
	if (!snapshot) {
		return;
	}
	if (snapshot.navigation) {
		queryClient.setQueryData(
			ensembleQueryKeys.repositoryWorkspaceNavigation(),
			snapshot.navigation,
		);
	}
	if (snapshot.health) {
		queryClient.setQueryData(ensembleQueryKeys.health(), snapshot.health);
	}
	if (snapshot.openTargets) {
		queryClient.setQueryData(ensembleQueryKeys.workspaceOpenTargets(), {
			targets: snapshot.openTargets,
		});
	}
}

/**
 * Persists every successful Pi model catalog fetch (initial + background
 * refreshes) to localStorage so the next launch hydrates instantly. The cache
 * writer skips empty results, preserving the last-known-good catalog when `pi`
 * is momentarily unavailable.
 */
function persistPiModelsOnUpdate(): void {
	// Compare each event against the models query's precomputed `queryHash`
	// (TanStack stores it per query) so the cache-wide subscription does no
	// per-event JSON.stringify. The unsubscribe handle is intentionally dropped:
	// this client is a process-lifetime singleton.
	const modelsHash = hashKey(ensembleQueryKeys.piModels());
	queryClient.getQueryCache().subscribe((event) => {
		if (event.type !== 'updated' || event.query.queryHash !== modelsHash) {
			return;
		}
		const state = event.query.state;
		if (state.status !== 'success' || !state.data) {
			return;
		}
		writeCachedPiModels(state.data as ListPiModelsResult);
	});
}
