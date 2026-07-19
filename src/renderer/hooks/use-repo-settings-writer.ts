import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';

import {
	ensemblrQueryKeys,
	updateRepositorySettings,
} from '@/renderer/api/ensemblr';
import type { RepoProject } from '@/renderer/types/settings';
import type { RepositorySettingsPatch } from '@/shared/ipc/contracts/repository-settings';

/**
 * Persists personal per-repo settings (Git/Misc screens) to repository-scoped
 * SQLite through the shared config writer, then invalidates the resolution
 * snapshot so the screen reflects the new resolved values and source badges.
 * No-ops for an unknown repo (`project` is `undefined`).
 *
 * @param repoId - Repository whose settings are being edited.
 * @param project - Resolved repo project, or `undefined` for an unknown repo.
 * @returns A `save(patch)` callback that persists and refreshes.
 */
export function useRepoSettingsWriter(
	repoId: string,
	project: RepoProject,
): (patch: RepositorySettingsPatch) => Promise<void> {
	const queryClient = useQueryClient();

	return useCallback(
		async (patch: RepositorySettingsPatch): Promise<void> => {
			if (!project) {
				return;
			}

			try {
				const result = await updateRepositorySettings({
					repositoryId: repoId,
					settings: patch,
				});
				if (!result.ok) {
					toast.error('Could not save repository settings.');
					return;
				}
				await queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.settingsResolution(repoId),
				});
			} catch {
				toast.error('Could not save repository settings.');
			}
		},
		[project, queryClient, repoId],
	);
}
