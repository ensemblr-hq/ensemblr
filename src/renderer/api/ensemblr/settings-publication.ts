/** Thin wrappers over the guarded root-to-workspace settings publication IPC surface. */
import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	ApplySettingsPublicationRequest,
	ApplySettingsPublicationResult,
	CleanupSettingsPublicationRequest,
	CleanupSettingsPublicationResult,
	PreviewSettingsPublicationRequest,
	PreviewSettingsPublicationResult,
	RestoreSettingsPublicationRequest,
	RestoreSettingsPublicationResult,
	SettingsPublicationRecoveryStatusResult,
} from '@/shared/ipc/contracts/settings-publication';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/** Prepares a bounded native three-way merge without mutating either checkout. */
export function previewSettingsPublication(
	request: PreviewSettingsPublicationRequest,
): Promise<PreviewSettingsPublicationResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:preview-settings-publication', usesDatabase: true },
		() => getEnsemblrApi().previewSettingsPublication(request),
	);
}

/** Applies a clean preview after every source fingerprint still matches. */
export function applySettingsPublication(
	request: ApplySettingsPublicationRequest,
): Promise<ApplySettingsPublicationResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:apply-settings-publication', usesDatabase: true },
		() => getEnsemblrApi().applySettingsPublication(request),
	);
}

/** Restores the root to HEAD only after the copied destination is unchanged. */
export function cleanupSettingsPublication(
	request: CleanupSettingsPublicationRequest,
): Promise<CleanupSettingsPublicationResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:cleanup-settings-publication', usesDatabase: true },
		() => getEnsemblrApi().cleanupSettingsPublication(request),
	);
}

/** Restores one captured side only when no intervening edit would be lost. */
export function restoreSettingsPublication(
	request: RestoreSettingsPublicationRequest,
): Promise<RestoreSettingsPublicationResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:restore-settings-publication', usesDatabase: true },
		() => getEnsemblrApi().restoreSettingsPublication(request),
	);
}

/** Query options for a repository's durable settings-publication recovery records. */
export function settingsPublicationRecoveryStatusQuery(repositoryId: string) {
	return queryOptions({
		queryFn: async (): Promise<SettingsPublicationRecoveryStatusResult> =>
			profileElectronIpcCall(
				{
					channel: 'ensemblr:settings-publication-recovery-status',
					usesDatabase: true,
				},
				() =>
					getEnsemblrApi().settingsPublicationRecoveryStatus({ repositoryId }),
			),
		queryKey: ensemblrQueryKeys.settingsPublicationRecoveryStatus(repositoryId),
	});
}
