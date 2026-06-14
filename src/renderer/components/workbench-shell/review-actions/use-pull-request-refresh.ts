import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { ensembleQueryKeys } from '@/renderer/api/ensemble-queries';

/**
 * Manual pull-request-snapshot refresh with toast-on-error and in-flight state
 * for the spinner. Separated so the provider does not own loading UI flags.
 */
export function usePullRequestRefresh({
	workspaceId,
}: {
	workspaceId: string;
}): {
	isRefreshingPullRequest: boolean;
	refreshPullRequest: () => void;
} {
	const queryClient = useQueryClient();
	const [isRefreshingPullRequest, setIsRefreshingPullRequest] = useState(false);

	const refreshPullRequest = useCallback(async () => {
		setIsRefreshingPullRequest(true);
		try {
			await queryClient.refetchQueries({
				queryKey: ensembleQueryKeys.pullRequestSnapshot(workspaceId),
			});
		} catch (cause) {
			toast.error('Pull request refresh failed', {
				description: cause instanceof Error ? cause.message : undefined,
			});
		} finally {
			setIsRefreshingPullRequest(false);
		}
	}, [queryClient, workspaceId]);

	return {
		isRefreshingPullRequest,
		refreshPullRequest: () => void refreshPullRequest(),
	};
}
