import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { refreshPullRequestSnapshot } from '@/renderer/api/ensemblr-queries';

/**
 * Manual pull-request-snapshot refresh with toast-on-error and in-flight state
 * for the spinner. Forces a cache-bypassing `gh` fetch (a plain refetch would
 * return the main process's still-fresh 30s-cached snapshot), so the button
 * always reflects the live PR state.
 */
export function usePullRequestRefresh({
	workspaceCwd,
	workspaceId,
}: {
	workspaceCwd: string | null;
	workspaceId: string;
}): {
	isRefreshingPullRequest: boolean;
	refreshPullRequest: () => void;
} {
	const queryClient = useQueryClient();
	const [isRefreshingPullRequest, setIsRefreshingPullRequest] = useState(false);

	const refreshPullRequest = useCallback(async () => {
		if (!workspaceCwd) {
			return;
		}
		setIsRefreshingPullRequest(true);
		try {
			await refreshPullRequestSnapshot({
				queryClient,
				workspaceCwd,
				workspaceId,
			});
		} catch (cause) {
			toast.error('Pull request refresh failed', {
				description: cause instanceof Error ? cause.message : undefined,
			});
		} finally {
			setIsRefreshingPullRequest(false);
		}
	}, [queryClient, workspaceCwd, workspaceId]);

	return {
		isRefreshingPullRequest,
		refreshPullRequest: () => void refreshPullRequest(),
	};
}
