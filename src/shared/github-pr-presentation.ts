import type {
	GithubPullRequestSnapshotWire,
	GithubPullRequestWire,
} from './ipc/contracts/github';
import type {
	WorkspacePrPresentation,
	WorkspacePrPresentationStatus,
} from './ipc/contracts/repository-navigation';

/**
 * Collapses a cached GitHub PR snapshot into the compact status the workspace
 * sidebar row needs (number + a single presentation status). Mirrors the
 * renderer's fuller {@link buildPullRequestShellModel} derivation so the row
 * icon and the right-sidebar header agree on merged / blocked / checking /
 * ready, but stays dependency-free so the main process can derive and persist
 * it per workspace without importing renderer types.
 *
 * Carries the snapshot's own `syncedAt` so a consumer holding two observations
 * of the same workspace — this compact one and a full snapshot of its own — can
 * tell which describes GitHub more recently. Without it the two are only
 * orderable by which happens to be loaded, which is what lets a status move
 * backwards; see {@link isFresherPrObservation}.
 *
 * @param snapshot - The cached PR snapshot, or null when none is stored.
 * @returns The compact presentation, or null when the workspace has no PR.
 */
export function deriveWorkspacePrPresentation(
	snapshot: GithubPullRequestSnapshotWire | null,
): WorkspacePrPresentation | null {
	const pullRequest = snapshot?.pullRequest ?? null;
	if (!snapshot || !pullRequest) {
		return null;
	}
	return {
		number: pullRequest.number,
		status: derivePresentationStatus(pullRequest),
		syncedAt: snapshot.syncedAt,
	};
}

/**
 * The compact status for a pull request in any state: `merged`/`closed` mirror
 * GitHub's own state, and an open one collapses through the shared open-PR
 * policy.
 * @param pullRequest - The pull request wire record.
 * @returns The compact presentation status.
 */
function derivePresentationStatus(
	pullRequest: GithubPullRequestWire,
): WorkspacePrPresentationStatus {
	if (pullRequest.state === 'merged') {
		return 'merged';
	}
	if (pullRequest.state === 'closed') {
		return 'closed';
	}
	return deriveOpenPullRequestStatus(pullRequest);
}

/**
 * Whether an observation of a workspace's pull request stamped `candidateSyncedAt`
 * describes GitHub at least as recently as one stamped `incumbentSyncedAt`, and
 * may therefore replace it on screen.
 *
 * PR status reaches the UI down two independently-timed paths — a workspace's own
 * `gh`-backed snapshot, which only refreshes while something is mounted on it,
 * and the compact presentation persisted for every workspace by the background
 * sweeper. Either can be the older one at any moment, so choosing between them by
 * which is *loaded* rather than which is *newer* is what makes a row flip from
 * ready-to-merge back to checks-running on navigation. Every hand-off between the
 * two goes through this predicate so the reported status only ever moves forward.
 *
 * An absent or unreadable incumbent stamp yields true: there is no older claim to
 * protect. An unstamped *candidate* yields false whenever the incumbent is
 * stamped, because a candidate that cannot say when it observed GitHub is not
 * evidence that the incumbent is out of date — a `gh` failure returns no
 * snapshot at all, and letting that unseat a status the app does know would
 * replace a real pull request with "No PR".
 *
 * @param candidateSyncedAt - ISO timestamp of the observation offered.
 * @param incumbentSyncedAt - ISO timestamp of the observation on screen.
 * @returns True when the candidate may replace the incumbent.
 */
export function isFresherPrObservation(
	candidateSyncedAt: string | undefined,
	incumbentSyncedAt: string | undefined,
): boolean {
	const incumbent = parseTimestamp(incumbentSyncedAt);
	if (incumbent === null) {
		return true;
	}
	const candidate = parseTimestamp(candidateSyncedAt);
	return candidate !== null && candidate >= incumbent;
}

/**
 * Parses an ISO timestamp to epoch milliseconds.
 * @param value - The timestamp to parse, when there is one.
 * @returns The epoch milliseconds, or null when absent or unparseable.
 */
function parseTimestamp(value: string | undefined): number | null {
	if (!value) {
		return null;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** The subset of {@link WorkspacePrPresentationStatus} an OPEN PR can hold. */
export type OpenPullRequestPresentationStatus = Extract<
	WorkspacePrPresentationStatus,
	'blocked' | 'checking' | 'open' | 'ready'
>;

/**
 * Derives the presentation status for an OPEN pull request from its check
 * buckets and mergeability signals. Failing checks or policy blocks win over a
 * still-running check run, which in turn wins over a draft or ready state. This
 * is the single source of truth for open-PR status: the renderer's fuller
 * `buildPullRequestShellModel` delegates here so the active row and the cached
 * sidebar rows can never drift on merged/blocked/checking/ready.
 * @param pullRequest - The open pull request wire record.
 * @returns The presentation status for an open PR.
 */
export function deriveOpenPullRequestStatus(
	pullRequest: GithubPullRequestWire,
): OpenPullRequestPresentationStatus {
	const hasFailing = pullRequest.checks.some(
		(check) => check.bucket === 'failing',
	);
	const hasPending = pullRequest.checks.some(
		(check) => check.bucket === 'pending',
	);
	const isBlockedByPolicy =
		pullRequest.mergeable === 'conflicting' ||
		pullRequest.reviewDecision === 'CHANGES_REQUESTED' ||
		pullRequest.mergeStateStatus === 'BLOCKED' ||
		pullRequest.mergeStateStatus === 'DIRTY';

	if (hasFailing || isBlockedByPolicy) {
		return 'blocked';
	}
	if (hasPending) {
		return 'checking';
	}
	if (pullRequest.isDraft) {
		return 'open';
	}
	if (
		pullRequest.mergeable === 'mergeable' &&
		pullRequest.reviewDecision !== 'REVIEW_REQUIRED'
	) {
		return 'ready';
	}
	return 'open';
}
