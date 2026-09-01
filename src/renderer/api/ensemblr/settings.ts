/**
 * Queries derived from the resolved settings snapshot (`resolveSettings`).
 * These do not touch any GitHub IPC channel — they live here so settings
 * lookups stay discoverable in one place.
 */
import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { ReviewMergeSettings } from '@/renderer/types/settings';
import type { ConfigChangedBroadcast } from '@/shared/ipc/contracts/health';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';

import {
	ensemblrQueryKeys,
	getEnsemblrApi,
	getEnsemblrApiOrNull,
} from './query-keys';

/** Subscribes to `config.json` reloads (external edits of non-App sections); returns an unsubscribe fn. */
export function subscribeConfigChanged(
	listener: (event: ConfigChangedBroadcast) => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	return api ? api.onConfigChanged(listener) : () => undefined;
}

/** Resolved settings snapshot for the entire app, optionally scoped to a repository. */
export function settingsResolutionQuery(
	repository: { repositoryId: string; repositoryPath: string } | null,
) {
	return queryOptions({
		queryFn: async (): Promise<SettingsResolutionSnapshot> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:settings-resolution', usesDatabase: true },
				() =>
					getEnsemblrApi().resolveSettings({
						repository: repository ?? undefined,
					}),
			),
		queryKey: ensemblrQueryKeys.settingsResolution(
			repository?.repositoryId ?? null,
			repository?.repositoryPath,
		),
		// `.ensemblr/settings.toml` is hand-editable and only open workspace
		// worktrees are watched, so refetch on focus to pick up an outside edit.
		refetchOnWindowFocus: true,
		staleTime: 15_000,
	});
}

/**
 * Query options for the repository's resolved git lifecycle settings — the
 * archive-after-merge policy, whether archiving drops the local branch, and
 * whether a push sets upstream. Read by the merge flow and by the archive
 * confirmation dialog, which resolves against the worktree being archived.
 */
export function reviewMergeSettingsQuery(
	repository: { repositoryId: string; repositoryPath: string } | null,
) {
	return queryOptions({
		enabled: !!repository,
		queryFn: async (): Promise<ReviewMergeSettings> => {
			const snapshot = await profileElectronIpcCall(
				{ channel: 'ensemblr:settings-resolution', usesDatabase: true },
				() =>
					getEnsemblrApi().resolveSettings({
						repository: repository ?? undefined,
					}),
			);
			const settings = snapshot.repository?.settings ?? [];
			const readBoolean = (key: string) =>
				settings.find((setting) => setting.key === key)?.value === true;
			const readBooleanOr = (key: string, fallback: boolean) => {
				const found = settings.find((setting) => setting.key === key);
				return found ? found.value === true : fallback;
			};
			return {
				archiveAfterMerge: readBoolean('archiveAfterMerge'),
				deleteLocalBranchOnArchive: readBoolean('deleteLocalBranchOnArchive'),
				reclaimDiskOnArchive: readBooleanOr('reclaimDiskOnArchive', true),
				setUpstreamOnPush: readBooleanOr('setUpstreamOnPush', true),
			};
		},
		queryKey: ensemblrQueryKeys.reviewMergeSettings(
			repository?.repositoryId ?? '',
			repository?.repositoryPath ?? '',
		),
		staleTime: 30_000,
	});
}
