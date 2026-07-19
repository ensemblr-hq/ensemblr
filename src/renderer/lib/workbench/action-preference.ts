import type { RepoActionKey } from '@/renderer/state/preferences';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';

/**
 * Reads the resolved shared action preference (from committed
 * `.ensemblr/settings.toml` `[prompts]` via the resolver) for an action key, or
 * `''` when none is configured. The personal per-repo override still wins over
 * this in {@link resolveActionPreference}.
 * @param resolution - Resolved settings snapshot, when loaded.
 * @param key - Canonical repo action key.
 * @returns The resolved shared preference string, or `''`.
 */
export function sharedActionPreference(
	resolution: SettingsResolutionSnapshot | undefined,
	key: RepoActionKey,
): string {
	const value = resolution?.repository?.settings.find(
		(setting) => setting.key === `actionPreferences.${key}`,
	)?.value;

	return typeof value === 'string' ? value : '';
}

/**
 * Merges the personal per-repo action preference with the committed shared one:
 * a non-empty personal override wins (behavior-preserving for existing users),
 * otherwise the shared `[prompts]` value fills in.
 * @param personal - Personal override text from local repo settings.
 * @param shared - Resolved shared preference text.
 * @returns The effective preference text.
 */
export function resolveActionPreference(
	personal: string,
	shared: string,
): string {
	return personal.trim() ? personal : shared;
}
