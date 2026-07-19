import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	OpenRepositoryConfigFileRequest,
	OpenRepositoryConfigFileResult,
	UpdateRepositorySettingsRequest,
	UpdateRepositorySettingsResult,
} from '@/shared/ipc/contracts/repository-settings';

import { getEnsemblrApi } from './query-keys';

/** Persists the repo Git/Misc settings screen edits to repository-scoped SQLite. */
export function updateRepositorySettings(
	request: UpdateRepositorySettingsRequest,
): Promise<UpdateRepositorySettingsResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:update-repository-settings', usesDatabase: true },
		() => getEnsemblrApi().updateRepositorySettings(request),
	);
}

/** Opens the repo's committed `.ensemblr/settings.toml` in the user's editor, creating it if absent. */
export function openRepositoryConfigFile(
	request: OpenRepositoryConfigFileRequest,
): Promise<OpenRepositoryConfigFileResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:open-repository-config-file', usesDatabase: false },
		() => getEnsemblrApi().openRepositoryConfigFile(request),
	);
}
