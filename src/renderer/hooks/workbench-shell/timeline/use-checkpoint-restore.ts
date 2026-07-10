import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import {
	ensemblrQueryKeys,
	restoreCheckpoint,
} from '@/renderer/api/ensemblr-queries';

/**
 * Pending restore request. Branch/session ids are captured at request time so
 * the async confirm never reads stale component state if the active session
 * changes between click and confirmation.
 */
export interface CheckpointRestoreTarget {
	branchId: string;
	label: string;
	piSessionId: string;
	turnId: string;
}

/** Owns the restore-confirmation flow: target state, IPC call, invalidation. */
export function useCheckpointRestore(): {
	cancel: () => void;
	confirm: () => Promise<void>;
	request: (target: CheckpointRestoreTarget) => void;
	target: CheckpointRestoreTarget | null;
} {
	const queryClient = useQueryClient();
	const [target, setTarget] = useState<CheckpointRestoreTarget | null>(null);

	const cancel = useCallback(() => setTarget(null), []);

	const confirm = useCallback(async () => {
		if (!target) {
			return;
		}
		setTarget(null);
		const result = await restoreCheckpoint({
			confirm: true,
			turnId: target.turnId,
		});
		if (!result.ok) {
			toast.error('Restore failed', { description: result.error.message });
			return;
		}
		toast.success('Workspace restored', {
			description: `Files reverted to before “${target.label}”.`,
		});
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.piSessionEvents(target.branchId),
		});
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.checkpointsForSession(target.piSessionId),
		});
		// Restore rewrites workspace files, so every cached diff/preview is stale.
		void queryClient.invalidateQueries({
			queryKey: [...ensemblrQueryKeys.all, 'turn-diff'],
		});
		void queryClient.invalidateQueries({
			queryKey: [...ensemblrQueryKeys.all, 'file-preview'],
		});
	}, [queryClient, target]);

	return { cancel, confirm, request: setTarget, target };
}
