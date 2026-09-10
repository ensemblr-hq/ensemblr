import { lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceFileEntryWire } from '../../shared/ipc/contracts/workspace-files';

const TARGET_TIMEOUT_MS = 250;
const MAX_PENDING_TARGETS = 2;

/** Icon classification of a known symlink's target. */
type SymlinkTargetKind = NonNullable<
	WorkspaceFileEntryWire['symlinkTargetKind']
>;

/**
 * Process-wide probes retained until the actual stat completes, even after timeout.
 * Two stalled targets leave capacity in Node's default four-thread filesystem pool.
 */
const pendingTargets = new Map<string, Promise<SymlinkTargetKind>>();

/**
 * Shares and bounds target probes without mistaking a timeout for cancellation.
 * @param absolutePath - Symlink whose target to classify.
 * @returns The target kind, or unknown when inaccessible, too slow, or saturated.
 */
function readTargetKind(absolutePath: string): Promise<SymlinkTargetKind> {
	const pending = pendingTargets.get(absolutePath);
	if (pending) {
		return pending;
	}
	if (pendingTargets.size >= MAX_PENDING_TARGETS) {
		return Promise.resolve('unknown');
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<SymlinkTargetKind>((resolve) => {
		timer = setTimeout(() => resolve('unknown'), TARGET_TIMEOUT_MS);
	});
	const work = stat(absolutePath).then<SymlinkTargetKind, SymlinkTargetKind>(
		(target) => (target.isDirectory() ? 'directory' : 'file'),
		() => 'unknown',
	);
	const result = Promise.race([work, expired]).finally(() =>
		clearTimeout(timer),
	);
	pendingTargets.set(absolutePath, result);
	void work.then(() => pendingTargets.delete(absolutePath));
	return result;
}

/**
 * Marks symlinks before target probing so skipped or timed-out targets keep a badge.
 * @param workspaceCwd - Workspace root the entry belongs to.
 * @param entry - Listed file or directory to inspect without following the link.
 * @returns The entry with an unknown target kind if it is a symlink.
 */
async function markSymlink(
	workspaceCwd: string,
	entry: WorkspaceFileEntryWire,
): Promise<WorkspaceFileEntryWire> {
	if (entry.kind === 'directory') {
		return entry;
	}
	try {
		const linkStat = await lstat(path.join(workspaceCwd, entry.path));
		return linkStat.isSymbolicLink()
			? { ...entry, symlinkTargetKind: 'unknown' }
			: entry;
	} catch {
		return entry;
	}
}

/**
 * Adds icon-only target metadata without changing a link's leaf kind or reading
 * its contents. Target classification shares one short budget per listing;
 * missing or slow targets keep an unknown link marker. Probes run serially
 * within a listing so healthy links are not discarded at the global probe cap.
 * @param workspaceCwd - Workspace root the listed paths are relative to.
 * @param entries - Bounded listing of files and directories to annotate.
 * @returns Entries with target kinds attached to symbolic links only.
 */
export async function annotateSymlinkTargets(
	workspaceCwd: string,
	entries: readonly WorkspaceFileEntryWire[],
): Promise<WorkspaceFileEntryWire[]> {
	const annotated = await Promise.all(
		entries.map((entry) => markSymlink(workspaceCwd, entry)),
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let didExpire = false;
	const expired = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			didExpire = true;
			resolve(null);
		}, TARGET_TIMEOUT_MS);
	});
	try {
		for (const [index, entry] of annotated.entries()) {
			if (didExpire) {
				break;
			}
			if (entry.symlinkTargetKind !== 'unknown') {
				continue;
			}
			const symlinkTargetKind = await Promise.race([
				readTargetKind(path.join(workspaceCwd, entry.path)),
				expired,
			]);
			if (symlinkTargetKind === null) {
				break;
			}
			annotated[index] = { ...entry, symlinkTargetKind };
		}
		return annotated;
	} finally {
		clearTimeout(timer);
	}
}
