import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
	ensembleQueryKeys,
	stopPiSession,
} from '@/renderer/api/ensemble-queries';

/**
 * Returns a stop-by-id callback that aborts an arbitrary Pi session's in-flight
 * turn and refreshes the workspace session list so tab spinners settle.
 *
 * The composer controller already exposes `onStop` for the *active* session;
 * this covers background tabs, whose session is not bound to any live composer
 * instance (e.g. closing a running chat from the tab strip while a different
 * tab is focused).
 */
export function useStopPiSession(
	workspaceId: string,
): (sessionId: string) => Promise<void> {
	const queryClient = useQueryClient();
	const { mutateAsync } = useMutation({
		mutationFn: (sessionId: string) => stopPiSession({ sessionId }),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.piSessionsForWorkspace(workspaceId),
			});
		},
	});

	// Depend on `mutateAsync` (stable across renders) rather than the mutation
	// result object (recreated every render), so the returned callback identity
	// stays stable and does not churn callers' memo deps.
	return useCallback(
		async (sessionId: string) => {
			await mutateAsync(sessionId);
		},
		[mutateAsync],
	);
}
