import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
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
