import path from 'node:path';

/**
 * True when a configured executable value names a command to look up on the
 * shell PATH rather than a filesystem path, i.e. it carries no `/` and no
 * platform separator.
 * @param rawPath - Trimmed value from an executable-path setting.
 * @returns Whether the value is a bare command name.
 */
export function isBareCommand(rawPath: string): boolean {
	return !rawPath.includes('/') && !rawPath.includes(path.sep);
}

/**
 * Explains why a configured executable path cannot be used, or `null` when it
 * is usable. A relative path is refused rather than resolved because the main
 * process's working directory differs between a Finder launch and a terminal
 * launch, so the same setting would otherwise select a different binary — or
 * none — depending on how the app was started. Callers rule out bare command
 * names first; those are resolved on PATH instead of against a directory.
 * @param rawPath - Trimmed value from an executable-path setting.
 * @param settingKey - Key the value came from, named in the message.
 * @returns The rejection message, or `null` for an absolute or `~`-rooted path.
 */
export function findConfiguredPathRejection(
	rawPath: string,
	settingKey: string,
): string | null {
	if (rawPath === '~' || rawPath.startsWith('~/') || path.isAbsolute(rawPath)) {
		return null;
	}

	return `The ${settingKey} setting must be absolute, start with ~/, or be a bare command name.`;
}
