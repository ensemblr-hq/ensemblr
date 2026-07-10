/**
 * Queries derived from the resolved settings snapshot (`resolveSettings`).
 * These do not touch any GitHub IPC channel — they live here so settings
 * lookups stay discoverable in one place.
 */
import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { ReviewMergeSettings } from '@/renderer/types/settings';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

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
		),
		staleTime: 15_000,
	});
}

/** Query options for the repository's archive-after-merge policy settings. */
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
				setUpstreamOnPush: readBooleanOr('setUpstreamOnPush', true),
			};
		},
		queryKey: ensemblrQueryKeys.reviewMergeSettings(
			repository?.repositoryId ?? '',
		),
		staleTime: 30_000,
	});
}

/** A single resolved per-action Pi instruction template, with its source and raw value. */
interface AgentActionTemplateSetting {
	source?: string;
	value?: unknown;
}

/** Query options for the resolved per-action Pi instruction templates. */
export function agentActionTemplatesQuery(
	repository: { repositoryId: string; repositoryPath: string } | null,
) {
	return queryOptions({
		enabled: !!repository,
		queryFn: async (): Promise<Record<string, AgentActionTemplateSetting>> => {
			const snapshot = await profileElectronIpcCall(
				{ channel: 'ensemblr:settings-resolution', usesDatabase: true },
				() =>
					getEnsemblrApi().resolveSettings({
						repository: repository ?? undefined,
					}),
			);
			const templates: Record<string, AgentActionTemplateSetting> = {};
			for (const setting of snapshot.repository?.settings ?? []) {
				if (setting.key.startsWith('piActions.')) {
					templates[setting.key] = {
						source: setting.source,
						value: setting.value,
					};
				}
			}
			return templates;
		},
		queryKey: ensemblrQueryKeys.agentActionTemplates(
			repository?.repositoryId ?? '',
		),
		staleTime: 30_000,
	});
}
