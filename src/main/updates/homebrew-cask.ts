import { readdirSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Where Homebrew keeps its Caskroom: under the Apple-silicon prefix, then under
 * the Intel one. A custom `HOMEBREW_PREFIX` is not searched — the app is started
 * by launchd, not from the shell that exported it.
 */
const HOMEBREW_CASKROOMS: readonly string[] = [
	'/opt/homebrew/Caskroom',
	'/usr/local/Caskroom',
];

/**
 * Names the Homebrew cask that installed an app bundle, or null when none did.
 *
 * Homebrew moves a cask's app into place and leaves a symlink to it at
 * `<Caskroom>/<token>/<version>/<App>.app`; it writes nothing into the bundle
 * itself, so that link is the only evidence of ownership there is. Matching
 * the link's resolved target against the bundle, rather than looking for a
 * token named `ensemblr`, keeps the answer right for a cask renamed or served
 * from another tap, and it cannot match a bundle Homebrew did not put there.
 * @param bundlePath - Absolute path of the running `.app` bundle
 * @param caskrooms - Caskroom directories to search, most likely first
 * @returns The owning cask's token, or null when no Caskroom links to the bundle
 */
export function findHomebrewCask(
	bundlePath: string,
	caskrooms: readonly string[] = HOMEBREW_CASKROOMS,
): string | null {
	const bundle = resolvedPath(bundlePath);
	if (bundle === null) {
		return null;
	}
	const bundleName = basename(bundlePath);
	for (const caskroom of caskrooms) {
		for (const token of listEntries(caskroom)) {
			const versions = listEntries(join(caskroom, token));
			const linksHere = versions.some(
				(version) =>
					resolvedPath(join(caskroom, token, version, bundleName)) === bundle,
			);
			if (linksHere) {
				return token;
			}
		}
	}
	return null;
}

/**
 * Lists a directory's entries, skipping the dot-directories Homebrew keeps its
 * own records in (`.metadata`) and treating an unreadable or missing directory
 * as empty — a Mac without Homebrew has no Caskroom at all.
 * @param directory - Directory to list
 * @returns Entry names, or an empty list when the directory cannot be read
 */
function listEntries(directory: string): string[] {
	try {
		return readdirSync(directory).filter((entry) => !entry.startsWith('.'));
	} catch {
		return [];
	}
}

/**
 * Resolves a path through every symlink with the OS's own `realpath`, so a
 * Caskroom link and the bundle it points at compare equal however either was
 * spelled — letter case on a case-insensitive volume included.
 * @param target - Path to resolve
 * @returns The canonical path, or null when it does not exist
 */
function resolvedPath(target: string): string | null {
	try {
		return realpathSync.native(target);
	} catch {
		return null;
	}
}
