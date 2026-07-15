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
 * @param snapshot - The cached PR snapshot, or null when none is stored.
 * @returns The compact presentation, or null when the workspace has no PR.
 */
export function deriveWorkspacePrPresentation(
	snapshot: GithubPullRequestSnapshotWire | null,
): WorkspacePrPresentation | null {
	const pullRequest = snapshot?.pullRequest ?? null;
	if (!pullRequest) {
		return null;
	}
	if (pullRequest.state === 'merged') {
		return { number: pullRequest.number, status: 'merged' };
	}
	if (pullRequest.state === 'closed') {
		return { number: pullRequest.number, status: 'closed' };
	}
	return {
		number: pullRequest.number,
		status: deriveOpenPullRequestStatus(pullRequest),
	};
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
