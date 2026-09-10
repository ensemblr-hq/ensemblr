import type { Stats } from 'node:fs';
import { lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceFileEntryWire } from '../../shared/ipc/contracts/workspace-files';

const METADATA_TIMEOUT_MS = 250;
const MAX_PENDING_PROBES = 2;

/** A completed stat, an inaccessible entry (undefined), or unfinished work (null). */
type Metadata = Stats | undefined | null;

/**
 * Process-wide probes retained until the actual stat or lstat completes, even after timeout.
 * Two stalled probes leave capacity in Node's default four-thread filesystem pool.
 */
const pendingMetadata = new Map<string, Promise<Metadata>>();

/**
 * Shares and bounds metadata probes without mistaking a timeout for cancellation.
 * @param absolutePath - Entry whose metadata to inspect.
 * @param operation - Whether to inspect the link itself or follow its target.
 * @returns Completed metadata, undefined on failure, or null when too slow or saturated.
 */
function readMetadata(
	absolutePath: string,
	operation: 'lstat' | 'stat',
): Promise<Metadata> {
	const key = `${operation}:${absolutePath}`;
	const pending = pendingMetadata.get(key);
	if (pending) {
		return pending;
	}
	if (pendingMetadata.size >= MAX_PENDING_PROBES) {
		return Promise.resolve(null);
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<Metadata>((resolve) => {
		timer = setTimeout(() => resolve(null), METADATA_TIMEOUT_MS);
	});
	const work = (operation === 'lstat' ? lstat : stat)(absolutePath).catch(
		() => undefined,
	);
	const result = Promise.race([work, expired]).finally(() =>
		clearTimeout(timer),
	);
	pendingMetadata.set(key, result);
	void work.then(() => pendingMetadata.delete(key));
	return result;
}

/**
 * Marks symlinks before target probing so skipped or timed-out targets keep a badge.
 * @param workspaceCwd - Workspace root the entry belongs to.
 * @param entry - Listed file or directory to inspect without following the link.
 * @returns A marked symlink, the original non-link or inaccessible entry, or null if unfinished.
 */
async function markSymlink(
	workspaceCwd: string,
	entry: WorkspaceFileEntryWire,
): Promise<WorkspaceFileEntryWire | null> {
	if (entry.kind === 'directory') {
		return entry;
	}
	const linkStat = await readMetadata(
		path.join(workspaceCwd, entry.path),
		'lstat',
	);
	if (linkStat === null) {
		return null;
	}
	return linkStat?.isSymbolicLink()
		? { ...entry, symlinkTargetKind: 'unknown' }
		: entry;
}

/**
 * Classifies entries in small batches, stopping new work after a short listing budget.
 * @param workspaceCwd - Workspace root the entries belong to.
 * @param entries - Listed entries to inspect without following links.
 * @returns Ordered classifications, with null for unfinished files and directories unchanged.
 */
async function markSymlinks(
	workspaceCwd: string,
	entries: readonly WorkspaceFileEntryWire[],
): Promise<(WorkspaceFileEntryWire | null)[]> {
	const annotated = entries.map((entry) =>
		entry.kind === 'directory' ? entry : null,
	);
	const deadline = Date.now() + METADATA_TIMEOUT_MS;
	for (let index = 0; index < entries.length; index += MAX_PENDING_PROBES) {
		if (Date.now() >= deadline) {
			break;
		}
		const batch = await Promise.all(
			entries
				.slice(index, index + MAX_PENDING_PROBES)
				.map((entry) => markSymlink(workspaceCwd, entry)),
		);
		for (const [offset, entry] of batch.entries()) {
			annotated[index + offset] = entry;
		}
	}
	return annotated;
}

/**
 * Adds icon-only target metadata without changing a link's leaf kind or reading
 * its contents. Initial batches and serial target classification each have a short
 * listing budget, and every probe has a deadline. Unfinished classifications keep
 * an unknown marker; target probing requires a completed symlink classification.
 * @param workspaceCwd - Workspace root the listed paths are relative to.
 * @param entries - Bounded listing of files and directories to annotate.
 * @returns Entries with target kinds for known links and unknown markers for unfinished files.
 */
export async function annotateSymlinkTargets(
	workspaceCwd: string,
	entries: readonly WorkspaceFileEntryWire[],
): Promise<WorkspaceFileEntryWire[]> {
	const annotated = await markSymlinks(workspaceCwd, entries);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let didExpire = false;
	const expired = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			didExpire = true;
			resolve(null);
		}, METADATA_TIMEOUT_MS);
	});
	try {
		for (const [index, entry] of annotated.entries()) {
			if (didExpire) {
				break;
			}
			if (entry?.symlinkTargetKind !== 'unknown') {
				continue;
			}
			const target = await Promise.race([
				readMetadata(path.join(workspaceCwd, entry.path), 'stat'),
				expired,
			]);
			if (didExpire) {
				break;
			}
			annotated[index] = {
				...entry,
				symlinkTargetKind: target
					? target.isDirectory()
						? 'directory'
						: 'file'
					: 'unknown',
			};
		}
		return annotated.map(
			(entry, index) =>
				entry ?? { ...entries[index], symlinkTargetKind: 'unknown' },
		);
	} finally {
		clearTimeout(timer);
	}
}
