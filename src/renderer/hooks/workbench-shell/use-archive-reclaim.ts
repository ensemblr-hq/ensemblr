import { useCallback, useState } from 'react';

import {
	isEnsemblrApiAvailable,
	reclaimArchivedWorkspaceDisk,
} from '@/renderer/api/ensemblr-queries';
import type {
	ArchivedWorkspaceListEntry,
	ReclaimArchivedWorkspaceDiskDiagnostic,
	ReclaimArchivedWorkspaceDiskEntry,
	ReclaimArchivedWorkspaceDiskResult,
} from '@/shared/ipc/contracts/workspace';

/** What a reclaim run reported back to the archive browser. */
interface ReclaimReport {
	/**
	 * The first failure's diagnostics. `workspaceId` is null for a problem with
	 * the request itself, which belongs to no row and so is shown above the list.
	 */
	diagnostics: {
		entries: ReclaimArchivedWorkspaceDiskDiagnostic[];
		workspaceId: string | null;
	} | null;
	/** Total bytes freed, or null when nothing was reclaimed. */
	reclaimedBytes: number | null;
}

/**
 * Turns a rejected reclaim call into the same diagnostic shape a refused one
 * produces, so an unexpected throw in main reads as a failed run rather than
 * disappearing into an unhandled rejection.
 *
 * The code carries the wording, translated; `message` holds only the runtime
 * specifics the diagnostics list appends when there are any, so a throw with
 * nothing to add leaves it empty rather than English.
 * @param cause - Whatever the rejected promise carried.
 * @returns The report to show for it.
 */
function reportForThrow(cause: unknown): ReclaimReport {
	return {
		diagnostics: {
			entries: [
				{
					code: 'worktree-prune-failed',
					message: cause instanceof Error ? cause.message : '',
					severity: 'error',
				},
			],
			workspaceId: null,
		},
		reclaimedBytes: null,
	};
}

/**
 * Chooses which of a run's diagnostics the browser shows, in the order that
 * matters to the user: a request the service refused outright, then the first
 * row that failed, then a row it skipped because there was nothing there.
 *
 * A skip is reported rather than swallowed for the same reason the others are —
 * a click that removes nothing and says nothing is indistinguishable from a
 * click that did not register.
 * @param options - The run's result plus its failed and skipped entries.
 * @returns The diagnostics to display, or null when the run was clean.
 */
function pickDiagnostics({
	failed,
	result,
	skipped,
}: {
	failed: ReclaimArchivedWorkspaceDiskEntry | undefined;
	result: ReclaimArchivedWorkspaceDiskResult;
	skipped: readonly ReclaimArchivedWorkspaceDiskEntry[];
}): ReclaimReport['diagnostics'] {
	if (result.diagnostics.length > 0) {
		return { entries: result.diagnostics, workspaceId: null };
	}
	if (failed) {
		return { entries: failed.diagnostics, workspaceId: failed.workspaceId };
	}
	const [firstSkipped] = skipped;
	if (result.reclaimedCount === 0 && firstSkipped) {
		return {
			entries: firstSkipped.diagnostics,
			workspaceId: firstSkipped.workspaceId,
		};
	}
	return null;
}

/**
 * Owns the archive browser's disk-reclaim state: which row is running, whether
 * the bulk run is in flight, how much it freed, and the diagnostics a failure
 * produced.
 *
 * Split out because reclaiming is the one archive action that is both per-row
 * and bulk, so its state does not fit the single-pending-row shape the restore
 * and purge actions share.
 * @param onReclaimed - Invalidates the caller's queries once a run frees anything.
 * @returns The reclaim state plus the two handlers the browser binds to buttons.
 */
export function useArchiveReclaim(onReclaimed: () => Promise<void>) {
	const [reclaimingId, setReclaimingId] = useState<string | null>(null);
	const [isReclaimingAll, setIsReclaimingAll] = useState(false);
	const [report, setReport] = useState<ReclaimReport>({
		diagnostics: null,
		reclaimedBytes: null,
	});

	const run = useCallback(
		async (workspaceIds: string[]) => {
			if (!isEnsemblrApiAvailable() || workspaceIds.length === 0) {
				return;
			}
			setReport({ diagnostics: null, reclaimedBytes: null });

			let result: Awaited<ReturnType<typeof reclaimArchivedWorkspaceDisk>>;
			try {
				result = await reclaimArchivedWorkspaceDisk({ workspaceIds });
			} catch (cause) {
				setReport(reportForThrow(cause));
				return;
			}

			const failed = result.entries.find(
				(entry) => entry.status === 'failure' && entry.diagnostics.length > 0,
			);
			const skipped = result.entries.filter(
				(entry) => entry.status === 'skipped' && entry.diagnostics.length > 0,
			);

			setReport({
				diagnostics: pickDiagnostics({ failed, result, skipped }),
				reclaimedBytes: result.reclaimedCount > 0 ? result.bytesFreed : null,
			});

			// A skip means the row's `pathExists` was stale — the folder went away
			// between the listing and the click — so the list has to be refetched or
			// the button that just did nothing stays exactly where it was.
			if (result.reclaimedCount > 0 || skipped.length > 0) {
				await onReclaimed();
			}
		},
		[onReclaimed],
	);

	// Both handlers clear their pending flag in a `finally`: `run` catches the
	// call itself, but `onReclaimed` refetches queries and can reject too, and a
	// flag left set disables every button in the dialog until it is remounted.
	const reclaimOne = useCallback(
		(entry: ArchivedWorkspaceListEntry) => {
			void (async () => {
				setReclaimingId(entry.id);
				try {
					await run([entry.id]);
				} finally {
					setReclaimingId(null);
				}
			})();
		},
		[run],
	);

	const reclaimAll = useCallback(
		(entries: readonly ArchivedWorkspaceListEntry[]) => {
			void (async () => {
				setIsReclaimingAll(true);
				try {
					await run(entries.map((entry) => entry.id));
				} finally {
					setIsReclaimingAll(false);
				}
			})();
		},
		[run],
	);

	const clearReport = useCallback(() => {
		setReport({ diagnostics: null, reclaimedBytes: null });
	}, []);

	return {
		clearReport,
		diagnostics: report.diagnostics,
		isReclaimingAll,
		reclaimAll,
		reclaimOne,
		reclaimedBytes: report.reclaimedBytes,
		reclaimingId,
	};
}
