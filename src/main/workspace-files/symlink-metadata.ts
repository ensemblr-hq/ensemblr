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

/** One phase's shared wait budget: the single timer every probe in it races against. */
interface ProbeBudget {
	/** Resolves null once the phase's wait budget is spent. */
	expired: Promise<null>;
	/** Reports whether the budget is already spent, so no further probe launches. */
	hasExpired: () => boolean;
	/** Clears the budget's timer so a finished listing leaves none pending. */
	dispose: () => void;
}

/**
 * Opens one wait budget for a classification phase, shared by every probe in it.
 * The wait belongs to the phase rather than to each probe, so a batch launched
 * just before the deadline is abandoned with it instead of extending the listing
 * by another full timeout.
 * @returns The budget's expiry promise, its spent check, and its disposer.
 */
function openProbeBudget(): ProbeBudget {
	let didExpire = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			didExpire = true;
			resolve(null);
		}, METADATA_TIMEOUT_MS);
	});
	return {
		dispose: () => clearTimeout(timer),
		expired,
		hasExpired: () => didExpire,
	};
}

/**
 * Shares and bounds metadata probes without mistaking a timeout for cancellation.
 * @param absolutePath - Entry whose metadata to inspect.
 * @param operation - Whether to inspect the link itself or follow its target.
 * @param budget - Wait budget this probe races against.
 * @returns Completed metadata, undefined on failure, or null when too slow or saturated.
 */
function readMetadata(
	absolutePath: string,
	operation: 'lstat' | 'stat',
	budget: ProbeBudget,
): Promise<Metadata> {
	const key = `${operation}:${absolutePath}`;
	const pending = pendingMetadata.get(key);
	if (pending) {
		return pending;
	}
	if (pendingMetadata.size >= MAX_PENDING_PROBES) {
		return Promise.resolve(null);
	}
	const work = (operation === 'lstat' ? lstat : stat)(absolutePath).catch(
		() => undefined,
	);
	const result = Promise.race<Metadata>([work, budget.expired]);
	pendingMetadata.set(key, result);
	void work.then(() => pendingMetadata.delete(key));
	return result;
}

/**
 * Reports how many probes may still be launched process-wide, so a batch never
 * includes work the cap would drop unprobed while a stalled probe holds a slot.
 * @returns The number of free slots, zero once the cap is reached.
 */
function availableProbeSlots(): number {
	return MAX_PENDING_PROBES - pendingMetadata.size;
}

/**
 * Marks a symlink before target probing so a skipped or timed-out target keeps a badge.
 * @param workspaceCwd - Workspace root the entry belongs to.
 * @param entry - Listed file to inspect without following the link.
 * @param budget - Wait budget the link probe races against.
 * @returns A marked symlink, the original non-link or inaccessible entry, or null if unfinished.
 */
async function markSymlink(
	workspaceCwd: string,
	entry: WorkspaceFileEntryWire,
	budget: ProbeBudget,
): Promise<WorkspaceFileEntryWire | null> {
	const linkStat = await readMetadata(
		path.join(workspaceCwd, entry.path),
		'lstat',
		budget,
	);
	if (linkStat === null) {
		return null;
	}
	return linkStat?.isSymbolicLink()
		? { ...entry, symlinkTargetKind: 'unknown' }
		: entry;
}

/**
 * Probes the entries the caller could not classify from git or a directory read,
 * in small batches, stopping new work once the phase budget is spent.
 * @param workspaceCwd - Workspace root the entries belong to.
 * @param entries - Listed entries, already marked where the caller knew.
 * @param probePaths - Paths whose symlink status only an lstat can settle.
 * @param budget - Wait budget shared by every probe in this phase.
 * @returns Ordered classifications, with null for unfinished probes and every other entry as given.
 */
async function markSymlinks(
	workspaceCwd: string,
	entries: readonly WorkspaceFileEntryWire[],
	probePaths: ReadonlySet<string>,
	budget: ProbeBudget,
): Promise<(WorkspaceFileEntryWire | null)[]> {
	const annotated = entries.map((entry) =>
		entry.kind === 'file' && probePaths.has(entry.path) ? null : entry,
	);
	const unclassified = annotated.flatMap((entry, index) =>
		entry === null ? [index] : [],
	);
	let cursor = 0;
	while (cursor < unclassified.length) {
		const slots = availableProbeSlots();
		if (budget.hasExpired() || slots <= 0) {
			break;
		}
		const batch = unclassified.slice(cursor, cursor + slots);
		cursor += batch.length;
		const classified = await Promise.all(
			batch.map((index) => markSymlink(workspaceCwd, entries[index], budget)),
		);
		for (const [offset, entry] of classified.entries()) {
			annotated[batch[offset]] = entry;
		}
	}
	return annotated;
}

/**
 * Resolves the target kind of every entry a completed lstat proved to be a symlink,
 * leaving an unresolved target on its unknown marker so the link keeps its badge.
 * @param workspaceCwd - Workspace root the entries belong to.
 * @param annotated - Classifications from the symlink phase, edited in place.
 * @param budget - Wait budget shared by every target probe.
 */
async function resolveSymlinkTargets(
	workspaceCwd: string,
	annotated: (WorkspaceFileEntryWire | null)[],
	budget: ProbeBudget,
): Promise<void> {
	for (const [index, entry] of annotated.entries()) {
		if (budget.hasExpired()) {
			break;
		}
		if (entry?.symlinkTargetKind !== 'unknown') {
			continue;
		}
		const target = await readMetadata(
			path.join(workspaceCwd, entry.path),
			'stat',
			budget,
		);
		if (!target) {
			continue;
		}
		annotated[index] = {
			...entry,
			symlinkTargetKind: target.isDirectory() ? 'directory' : 'file',
		};
	}
}

/**
 * Adds icon-only target metadata without changing a link's leaf kind or reading
 * its contents. Entries already marked by the caller — from a git index mode or
 * a directory read — cost nothing here; only `probePaths` is lstat'd, and
 * classification and target resolution each get their own wait budget so a
 * stalled filesystem bounds the listing rather than blocking it.
 *
 * An entry whose probe never completed stays unmarked: a marker means a link was
 * observed, never that one was assumed. Probing cannot cover a large listing —
 * an lstat round trip runs 0.1ms to 4ms depending on filesystem load, so the
 * budget buys anywhere from a few dozen entries to a few thousand — which is
 * why the free sources carry the common cases and the fallback under-reports
 * rather than turning an unprobed tail into a tree of shortcuts.
 * @param workspaceCwd - Workspace root the listed paths are relative to.
 * @param entries - Bounded listing of files and directories to annotate.
 * @param probePaths - Paths the caller could not classify, to be lstat'd here.
 * @returns Entries with target kinds for observed links and no marker elsewhere.
 */
export async function annotateSymlinkTargets(
	workspaceCwd: string,
	entries: readonly WorkspaceFileEntryWire[],
	probePaths: ReadonlySet<string>,
): Promise<WorkspaceFileEntryWire[]> {
	const classification = openProbeBudget();
	let annotated: (WorkspaceFileEntryWire | null)[];
	try {
		annotated = await markSymlinks(
			workspaceCwd,
			entries,
			probePaths,
			classification,
		);
	} finally {
		classification.dispose();
	}
	const targets = openProbeBudget();
	try {
		await resolveSymlinkTargets(workspaceCwd, annotated, targets);
	} finally {
		targets.dispose();
	}
	return annotated.map((entry, index) => entry ?? entries[index]);
}
