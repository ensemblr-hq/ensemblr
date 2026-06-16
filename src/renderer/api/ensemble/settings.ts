/**
 * Queries derived from the resolved settings snapshot (`resolveSettings`).
 * These do not touch any GitHub IPC channel — they live here so settings
 * lookups stay discoverable in one place.
 */
import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

/** Resolved settings snapshot for the entire app, optionally scoped to a repository. */
export function settingsResolutionQuery(
	repository: { repositoryId: string; repositoryPath: string } | null,
) {
	return queryOptions({
		queryFn: async (): Promise<SettingsResolutionSnapshot> =>
			profileElectronIpcCall(
				{ channel: 'ensemble:settings-resolution', usesDatabase: true },
				() =>
					getEnsembleApi().resolveSettings({
						repository: repository ?? undefined,
					}),
			),
		queryKey: ensembleQueryKeys.settingsResolution(
			repository?.repositoryId ?? null,
		),
		staleTime: 15_000,
	});
}

export interface ReviewMergeSettings {
	archiveAfterMerge: boolean;
	deleteLocalBranchOnArchive: boolean;
	setUpstreamOnPush: boolean;
}

/** Query options for the repository's archive-after-merge policy settings. */
export function reviewMergeSettingsQuery(
	repository: { repositoryId: string; repositoryPath: string } | null,
) {
	return queryOptions({
		enabled: !!repository,
		queryFn: async (): Promise<ReviewMergeSettings> => {
			const snapshot = await profileElectronIpcCall(
				{ channel: 'ensemble:settings-resolution', usesDatabase: true },
				() =>
					getEnsembleApi().resolveSettings({
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
		queryKey: ensembleQueryKeys.reviewMergeSettings(
			repository?.repositoryId ?? '',
		),
		staleTime: 30_000,
	});
}

export interface AgentActionTemplateSetting {
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
				{ channel: 'ensemble:settings-resolution', usesDatabase: true },
				() =>
					getEnsembleApi().resolveSettings({
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
		queryKey: ensembleQueryKeys.agentActionTemplates(
			repository?.repositoryId ?? '',
		),
		staleTime: 30_000,
	});
}
