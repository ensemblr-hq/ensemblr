import type {
	SettingsResolutionGroupSnapshot,
	SettingsResolutionSnapshot,
} from '../../shared/ipc/contracts/settings-resolution.ts';
import {
	DEFAULT_PERMISSION_MODE,
	normalizePermissionMode,
	type PermissionMode,
} from '../../shared/permissions.ts';

/** Settings key the Security screen writes and every permission gate reads. */
export const PERMISSION_MODE_SETTING_KEY = 'security.permissionMode';

/**
 * Identifies the repository whose permission mode applies to one request. The
 * renderer names a workspace rather than a repository on almost every channel,
 * so all three shapes are accepted and narrowed to a repository by the resolver.
 */
export interface PermissionModeContext {
	repositoryId?: string | null;
	workspaceCwd?: string | null;
	workspaceId?: string | null;
}

/**
 * Reads `security.permissionMode` out of a resolved-settings snapshot.
 * Repository scope is authoritative; the app scope is the fallback when the
 * repository sets nothing. The repository group always carries the key because
 * it has a built-in default, so provenance rather than presence is what decides
 * whether the repository expressed a choice.
 * @param snapshot - Resolved settings, ideally resolved with a repository.
 * @returns The mode to enforce, defaulting to {@link DEFAULT_PERMISSION_MODE}.
 */
export function readPermissionModeFromSnapshot(
	snapshot: SettingsResolutionSnapshot,
): PermissionMode {
	const repositoryChoice = readGroupChoice(snapshot.repository);
	if (repositoryChoice !== null) {
		return repositoryChoice;
	}

	const appChoice = readGroupChoice(snapshot.app);
	return appChoice ?? DEFAULT_PERMISSION_MODE;
}

/**
 * Reads one resolution group's permission mode, treating a built-in default as
 * "no choice made" so the next scope down gets its turn.
 * @param group - Resolved settings for one scope, when that scope was resolved.
 * @returns The chosen mode, or `null` when the scope expressed no preference.
 */
function readGroupChoice(
	group: SettingsResolutionGroupSnapshot | undefined,
): PermissionMode | null {
	const setting = group?.settings.find(
		(entry) => entry.key === PERMISSION_MODE_SETTING_KEY,
	);

	if (!setting || setting.source === 'built-in-default') {
		return null;
	}

	return normalizePermissionMode(setting.value);
}
