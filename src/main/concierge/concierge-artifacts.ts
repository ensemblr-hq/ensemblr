import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ConciergeArtifactWire } from '../../shared/ipc/contracts/concierge.ts';
import type { ConciergeHome } from './concierge-home.ts';

/**
 * How deep the walk goes below `artifacts/`. The Concierge is told to write
 * reports there, not to build a tree, so a nested folder or two is the most a
 * real home has — and a bound keeps a symlinked directory from turning a menu
 * listing into an unbounded traversal.
 */
const MAX_ARTIFACT_DEPTH = 4;

/** How many artifacts the listing carries, well past what the `@` menu shows. */
const MAX_ARTIFACTS = 500;

/**
 * Where the walk stops regardless of what it has found.
 *
 * Separate from {@link MAX_ARTIFACTS}, and an order of magnitude above it, so
 * the two mean one thing each: this bounds the `stat` calls a listing costs,
 * while that bounds the payload. Capping the walk at the listing size instead
 * would truncate in directory order and then call the result newest-first,
 * which is the one case where the sort would be a lie.
 */
const MAX_SCANNED_ENTRIES = 5_000;

/**
 * Lists the files under the Concierge's `artifacts/` directory, newest first, so
 * the composer can offer them and a chip can point at one.
 *
 * Directories are walked but never listed: an artifact is a document the user
 * can read, and offering a folder in the `@` menu gives them a row that opens
 * nothing. A home that has not been created yet lists as empty rather than
 * failing — the directory is seeded on launch, but a listing that raced that is
 * not worth an error.
 *
 * The walk is bounded before the sort, so a home past {@link
 * MAX_SCANNED_ENTRIES} files reports the newest of what was reached rather than
 * the newest of everything.
 * @param home - The Concierge home whose artifacts to list.
 * @returns The artifacts, most recently modified first.
 */
export async function listConciergeArtifacts(
	home: ConciergeHome,
): Promise<readonly ConciergeArtifactWire[]> {
	const found: ConciergeArtifactWire[] = [];
	await collectArtifacts(home.artifactsPath, '', 0, found);
	return found
		.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
		.slice(0, MAX_ARTIFACTS);
}

/**
 * Walks one directory, appending its files and recursing into its subfolders.
 * Unreadable entries are skipped rather than thrown: one bad symlink must not
 * cost the user every other artifact.
 * @param absoluteDirectory - Directory to read.
 * @param relativePrefix - Path of that directory relative to `artifacts/`.
 * @param depth - How far below `artifacts/` this directory sits.
 * @param found - Accumulator the walk appends to.
 */
async function collectArtifacts(
	absoluteDirectory: string,
	relativePrefix: string,
	depth: number,
	found: ConciergeArtifactWire[],
): Promise<void> {
	if (depth > MAX_ARTIFACT_DEPTH || found.length >= MAX_SCANNED_ENTRIES) {
		return;
	}
	let entries: string[];
	try {
		entries = await readdir(absoluteDirectory);
	} catch {
		return;
	}
	for (const entry of entries.sort()) {
		if (found.length >= MAX_SCANNED_ENTRIES) {
			return;
		}
		if (entry.startsWith('.')) {
			continue;
		}
		const absolutePath = path.join(absoluteDirectory, entry);
		const relativePath = relativePrefix ? `${relativePrefix}/${entry}` : entry;
		try {
			const stats = await stat(absolutePath);
			if (stats.isDirectory()) {
				await collectArtifacts(absolutePath, relativePath, depth + 1, found);
				continue;
			}
			if (stats.isFile()) {
				found.push({
					modifiedAt: stats.mtime.toISOString(),
					name: entry,
					relativePath,
					size: stats.size,
				});
			}
		} catch {}
	}
}
