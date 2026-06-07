import { QueryClient } from '@tanstack/react-query';

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
}
