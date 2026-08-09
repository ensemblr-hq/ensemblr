import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	ensemblrQueryKeys,
	restoreCheckpoint,
} from '@/renderer/api/ensemblr-queries';
import type { CheckpointRestoreTarget } from '@/renderer/types/workbench';

/** Owns the restore-confirmation flow: target state, IPC call, invalidation. */
export function useCheckpointRestore(): {
	cancel: () => void;
	confirm: () => Promise<void>;
	request: (target: CheckpointRestoreTarget) => void;
	target: CheckpointRestoreTarget | null;
} {
	const queryClient = useQueryClient();
	const { t } = useTranslation();
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
			toast.error(
				t('errors:checkpoint-restore.failed.title', 'Restore failed'),
				{
					description: result.error.message,
				},
			);
			return;
		}
		toast.success(
			t('errors:checkpoint-restore.restored.title', 'Workspace restored'),
			{
				description: t(
					'errors:checkpoint-restore.restored.description',
					'Files reverted to before “{{label}}”.',
					{ label: target.label },
				),
			},
		);
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.agentSessionEvents(target.branchId),
		});
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.checkpointsForSession(target.agentSessionId),
		});
		// Restore rewrites workspace files, so every cached diff/preview is stale.
		void queryClient.invalidateQueries({
			queryKey: [...ensemblrQueryKeys.all, 'turn-diff'],
		});
		void queryClient.invalidateQueries({
			queryKey: [...ensemblrQueryKeys.all, 'file-preview'],
		});
	}, [queryClient, t, target]);

	return { cancel, confirm, request: setTarget, target };
}
