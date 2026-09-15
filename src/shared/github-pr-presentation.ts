import type {
	GitBranchSyncWire,
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
 * `branchSync` rides along for the same reason the status does: it is already in
 * the snapshot this parses, so every row can report unpushed commits without the
 * renderer opening a second git query per workspace.
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
		branchSync: snapshot.branchSync,
		number: pullRequest.number,
		status: derivePresentationStatus({
			branchSync: snapshot.branchSync,
			observedAt: snapshot.syncedAt,
			pullRequest,
		}),
		syncedAt: snapshot.syncedAt,
	};
}

/**
 * Derives the compact presentation from a stored snapshot column, tolerating a
 * missing join or a malformed cache row.
 *
 * A row with no readable `syncedAt` yields no presentation rather than an
 * unstamped one: consumers order this observation against a live snapshot by
 * that timestamp, and an absent stamp would silently mean "always the older of
 * the two". It is also what the check-registration grace is measured against,
 * so an unstamped row could not be judged for staleness either.
 * @param snapshotJson - Raw cached snapshot JSON, or null when there is none.
 * @returns The compact PR presentation, or null when absent or unparseable.
 */
export function parseWorkspacePrPresentation(
	snapshotJson: string | null,
): WorkspacePrPresentation | null {
	return deriveWorkspacePrPresentation(parseSnapshotJson(snapshotJson));
}

/**
 * Whether a stored snapshot column describes an open pull request whose verdict
 * is still moving, which is what earns a workspace the sweeper's short cadence.
 *
 * Asks {@link isPullRequestUnsettled} rather than testing the presentation
 * status for `checking`: the two answer different questions, and a pull request
 * that is blocked *and* still running checks is exactly the row the sweeper must
 * not drop to the idle cadence.
 * @param snapshotJson - Raw cached snapshot JSON, or null when there is none.
 * @returns True when the cached pull request is open and unsettled.
 */
export function parseWorkspacePrUnsettled(
	snapshotJson: string | null,
): boolean {
	const snapshot = parseSnapshotJson(snapshotJson);
	const pullRequest = snapshot?.pullRequest;
	if (!snapshot || !pullRequest || pullRequest.state !== 'open') {
		return false;
	}
	return isPullRequestUnsettled({
		branchSync: snapshot.branchSync,
		observedAt: snapshot.syncedAt,
		pullRequest,
	});
}

/**
 * Parses a stored snapshot column, tolerating a missing join or a malformed
 * cache row, and rejecting one with no readable `syncedAt`.
 * @param snapshotJson - Raw cached snapshot JSON, or null when there is none.
 * @returns The parsed snapshot, or null when absent, unparseable, or unstamped.
 */
function parseSnapshotJson(
	snapshotJson: string | null,
): GithubPullRequestSnapshotWire | null {
	if (!snapshotJson) {
		return null;
	}
	try {
		const parsed = JSON.parse(snapshotJson) as GithubPullRequestSnapshotWire;
		return typeof parsed?.syncedAt === 'string' ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * The compact status for a pull request in any state: `merged`/`closed` mirror
 * GitHub's own state, and an open one collapses through the shared open-PR
 * policy.
 * @param options - The pull request, its branch sync state, and when the
 * snapshot observed GitHub.
 * @returns The compact presentation status.
 */
function derivePresentationStatus(
	options: OpenPullRequestStatusInput,
): WorkspacePrPresentationStatus {
	if (options.pullRequest.state === 'merged') {
		return 'merged';
	}
	if (options.pullRequest.state === 'closed') {
		return 'closed';
	}
	return deriveOpenPullRequestStatus(options);
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
 * How long an empty check rollup is read as GitHub still registering runs for a
 * head it has just accepted, rather than as a pull request that runs no checks.
 * Measured from the last time GitHub did report a check for this pull request,
 * against the moment the snapshot observed GitHub — so a repository that has
 * never run one is never held back, and a workflow that genuinely stops
 * producing runs (a path filter that no longer matches) settles once the window
 * lapses instead of waiting forever.
 *
 * It has to exceed the background sweeper's idle cadence, and that is the whole
 * reason it is not two minutes. `checksLastObservedAt` only advances on a fetch
 * that saw a *non-empty* rollup, so the first empty rollup a workspace on the
 * idle cadence observes is already one full idle interval past its stamp. At
 * equal values the strict comparison below can never hold and the test is dead
 * on that path — which is the sidebar row, not just the header pill.
 * `tests/main/sweep-cadence-invariant.test.ts` pins the relation, since
 * `src/shared/` must not import the main-process constant to state it here.
 */
export const CHECK_REGISTRATION_GRACE_MS = 180_000;

/**
 * `mergeStateStatus` values that mean GitHub will not take the merge: the merge
 * is gated (`BLOCKED`), cannot be created (`DIRTY`), or names a head the base has
 * moved past where the repository requires branches to be current (`BEHIND`).
 */
const BLOCKING_MERGE_STATES: ReadonlySet<string> = new Set([
	'BEHIND',
	'BLOCKED',
	'DIRTY',
]);

/**
 * GitHub's own verdict that the head commit's status is not (yet) passing.
 * `CLEAN` and `HAS_HOOKS` are the two mergeable-and-passing states, so
 * `UNSTABLE` is how a rollup that is still running or partially reported shows
 * up when the rollup rows themselves have not landed.
 */
const NON_PASSING_MERGE_STATE = 'UNSTABLE';

/** What {@link deriveOpenPullRequestStatus} needs to judge an open pull request. */
export interface OpenPullRequestStatusInput {
	/**
	 * The branch's sync state, used to tell a verdict about the branch tip from
	 * one GitHub has not recomputed yet. Required rather than optional so a
	 * caller decides for itself instead of skipping that test by omission; pass
	 * null where the snapshot genuinely has none.
	 */
	branchSync: GitBranchSyncWire | null;
	/** When the snapshot carrying this pull request observed GitHub. */
	observedAt: string;
	pullRequest: GithubPullRequestWire;
}

/**
 * Derives the presentation status for an OPEN pull request from its check
 * buckets and mergeability signals. Failing checks or policy blocks win over a
 * still-running check run, which in turn wins over a draft or ready state. This
 * is the single source of truth for open-PR status: the renderer's fuller
 * `buildPullRequestShellModel` delegates here so the active row and the cached
 * sidebar rows can never drift on merged/blocked/checking/ready.
 *
 * `ready` is withheld on three kinds of evidence that GitHub has not finished
 * with the head commit, because each of them otherwise reads as an absence of
 * bad news and offers a merge of work nothing has run: a rollup that is empty
 * only because the runs are still being queued, a `mergeStateStatus` GitHub
 * itself calls non-passing, and a pull request whose head the branch tip has
 * already passed.
 * @param options - The pull request, its branch sync state, and when the
 * snapshot observed GitHub.
 * @returns The presentation status for an open PR.
 */
export function deriveOpenPullRequestStatus(
	options: OpenPullRequestStatusInput,
): OpenPullRequestPresentationStatus {
	const { pullRequest } = options;
	if (hasFailingCheck(pullRequest) || isBlockedByPolicy(pullRequest)) {
		return 'blocked';
	}
	if (isPullRequestUnsettled(options)) {
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

/**
 * Whether GitHub's verdict on this open pull request is still moving, and the
 * app should therefore expect the status it has cached to go wrong soon.
 *
 * Deliberately independent of {@link deriveOpenPullRequestStatus}: that
 * collapses a pull request to one word for display and lets `blocked` win, which
 * makes it the wrong question for scheduling. A pull request can be blocked *and*
 * unsettled at once — a repository with branch protection reports
 * `mergeStateStatus: BLOCKED` for the whole time its required checks are
 * running, and a lint job that fails fast leaves the slow test job still going —
 * and those are precisely the rows whose cached status is about to change.
 * Reading `status === 'checking'` instead would drop every one of them onto the
 * idle cadence.
 * @param options - The pull request, its branch sync state, and when the
 * snapshot observed GitHub.
 * @returns True when something about this pull request is still in flight.
 */
function isPullRequestUnsettled({
	branchSync,
	observedAt,
	pullRequest,
}: OpenPullRequestStatusInput): boolean {
	return (
		pullRequest.checks.some((check) => check.bucket === 'pending') ||
		pullRequest.mergeStateStatus === NON_PASSING_MERGE_STATE ||
		awaitsCheckRegistration(pullRequest, observedAt) ||
		lagsBranchTip(pullRequest, branchSync)
	);
}

/**
 * Whether any check on the rollup has finished badly.
 * @param pullRequest - The open pull request wire record.
 * @returns True when at least one check failed.
 */
function hasFailingCheck(pullRequest: GithubPullRequestWire): boolean {
	return pullRequest.checks.some((check) => check.bucket === 'failing');
}

/**
 * Whether GitHub will refuse the merge on grounds other than a check result: a
 * conflicting diff, a review that asked for changes, or a `mergeStateStatus`
 * naming a gate the pull request has not cleared.
 * @param pullRequest - The open pull request wire record.
 * @returns True when policy blocks the merge.
 */
function isBlockedByPolicy(pullRequest: GithubPullRequestWire): boolean {
	return (
		pullRequest.mergeable === 'conflicting' ||
		pullRequest.reviewDecision === 'CHANGES_REQUESTED' ||
		BLOCKING_MERGE_STATES.has(pullRequest.mergeStateStatus ?? '')
	);
}

/**
 * Whether an empty check rollup is a gap GitHub is about to fill rather than a
 * pull request with no checks.
 *
 * GitHub advances a pull request's head as soon as it accepts a push and queues
 * that head's check runs moments later, so there is a window in which the rollup
 * is empty, mergeability still answers from the commit that already passed, and
 * nothing in the snapshot says the checks are coming. Reading that as `ready`
 * offers a merge of work nothing has run — and unlike {@link lagsBranchTip} it
 * survives the head catching up, so it is the window that outlasts every other
 * test here.
 *
 * `checksLastObservedAt` is the evidence that this pull request does have CI:
 * a repository that has never reported a check has no stamp and is never held
 * back, and one that stops reporting them settles once the grace lapses.
 * @param pullRequest - The open pull request wire record.
 * @param observedAt - When the snapshot observed GitHub.
 * @returns True when the rollup is empty but checks are expected to arrive.
 */
function awaitsCheckRegistration(
	pullRequest: GithubPullRequestWire,
	observedAt: string,
): boolean {
	if (pullRequest.checks.length > 0) {
		return false;
	}
	const lastObserved = parseTimestamp(pullRequest.checksLastObservedAt);
	const observed = parseTimestamp(observedAt);
	if (lastObserved === null || observed === null) {
		return false;
	}
	return observed - lastObserved < CHECK_REGISTRATION_GRACE_MS;
}

/**
 * Whether the pull request record still names the commit a push replaced — the
 * window in which GitHub is moving the PR head and queueing check runs for it.
 *
 * A verdict read in that window describes the *previous* commit, so reporting it
 * as `ready` offers a merge of work whose checks have not started. The test is
 * narrow on purpose, because the same shape of evidence has a second cause that
 * must not be caught: `ahead`/`behind` are counted against a remote-tracking ref
 * nothing in the app fetches for this branch, so a remote branch that moved on
 * without us (a suggestion committed from GitHub's UI, "Update branch", a
 * teammate's push) also reads as level with a PR head that differs.
 *
 * `headCommitKnownLocally` is what separates them: a PR waiting to catch up
 * names a commit this repository has, while a remote that ran ahead names one it
 * has never seen. Everything short of that evidence — an unfetched remote, a
 * branch with local work outstanding, a snapshot cached before either field
 * existed — is left to the checks GitHub did compute.
 *
 * @param pullRequest - The open pull request wire record.
 * @param branchSync - The branch's sync state, when the snapshot carries one.
 * @returns True when the PR's head is a commit of ours that its tip has passed.
 */
function lagsBranchTip(
	pullRequest: GithubPullRequestWire,
	branchSync: GitBranchSyncWire | null,
): boolean {
	if (!branchSync?.headSha || !pullRequest.headRefOid) {
		return false;
	}
	if (
		!branchSync.hasUpstream ||
		branchSync.ahead > 0 ||
		branchSync.behind > 0
	) {
		return false;
	}
	if (pullRequest.headCommitKnownLocally !== true) {
		return false;
	}
	return branchSync.headSha !== pullRequest.headRefOid;
}
