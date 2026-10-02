import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Reports whether a resolved path stays strictly below a resolved root. Both
 * sides must already be canonicalized; this compares strings and touches no
 * filesystem.
 * @param root - Canonical root the candidate must sit under.
 * @param candidate - Canonical candidate path.
 * @returns True when the candidate is inside the root.
 */
export function isInside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);

	return (
		relative !== '' &&
		relative !== '..' &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

/**
 * Canonicalizes a path through symlinks.
 * @param target - Path to resolve.
 * @returns The real path, or null when it cannot be resolved.
 */
export function realPathOrNull(target: string): string | null {
	try {
		return realpathSync.native(target);
	} catch {
		return null;
	}
}

/**
 * Reports whether a path is itself a symbolic link, without following it.
 * @param target - Path to inspect.
 * @returns True when the entry exists and is a symbolic link.
 */
export function isSymbolicLinkPath(target: string): boolean {
	try {
		return lstatSync(target).isSymbolicLink();
	} catch {
		return false;
	}
}

/**
 * Rejects a path segment that would steer a composed path somewhere other than
 * one level down: a separator, a relative hop, or an empty name.
 * @param segment - One path segment supplied by a caller.
 * @returns True when the segment names exactly one child entry.
 */
export function isSingleSegment(segment: string): boolean {
	return (
		segment.length > 0 &&
		segment !== '.' &&
		segment !== '..' &&
		!segment.includes('/') &&
		!segment.includes('\\') &&
		!segment.includes('\0')
	);
}

/**
 * Creates every level of `segments` under `root` and re-checks after each
 * `mkdir` that the level still resolves inside the root, so a committed
 * symlink anywhere along the chain refuses the write instead of redirecting it.
 *
 * A repository's own checkout is the hostile input here: `.context` and the
 * directories under it are checked out from the repository like any other path,
 * and a lexically composed path says nothing about where the filesystem will
 * actually land.
 * @param root - Trusted root the directory must stay inside.
 * @param segments - Directory names to create below the root, outermost first.
 * @returns The created directory's path, or null when a level escaped the root.
 */
export function ensureContainedDirectory(
	root: string,
	segments: readonly string[],
): string | null {
	const rootReal = realPathOrNull(root);
	if (
		rootReal === null ||
		segments.some((segment) => !isSingleSegment(segment))
	) {
		return null;
	}

	let directory = root;
	for (const segment of segments) {
		directory = path.join(directory, segment);
		mkdirSync(directory, { recursive: true });
		const directoryReal = realPathOrNull(directory);
		if (directoryReal === null || !isInside(rootReal, directoryReal)) {
			return null;
		}
	}

	return directory;
}
