/**
 * Closes out a workspace once its pull request merges: the board card moves to
 * Done, the issue the workspace was created from is closed wherever it lives
 * — a Linear issue moves to its team's completed state, a GitHub issue is closed
 * as completed — and the local copy of the base branch is fast-forwarded to the
 * merge.
 *
 * This is the app acting on a merge, not an agent acting on a ticket, which is
 * why it talks to the Linear service directly rather than through the
 * agent-control port that refuses completed states: the merge is the human
 * decision that the work is done, whether the Merge button or an agent's own
 * `gh pr merge` carried it out.
 */

import {
	LINEAR_TERMINAL_STATE_TYPES,
	type WorkspaceBoardStatusValue,
	type WorkspaceLinkedIssue,
} from '../../shared/agent-control.ts';
import type {
	GetLinearMetadataResult,
	LinearIssueWire,
	LinearResourceWire,
} from '../../shared/ipc/contracts/linear.ts';
import type { LocalBaseSyncOutcome } from '../../shared/workspace-merge.ts';
import type { LocalCommandService } from '../commands/local-command';
import type { PullRequestMergedEvent } from '../github';
import type { LinearService } from '../linear';

/** What became of the issue a merged workspace was created from. */
export type LinkedIssueCloseOut =
	| { status: 'already-closed' }
	| { status: 'closed' }
	| { message: string; status: 'failed' }
	| { status: 'no-linked-issue' };

/** The outcome of closing out one merged pull request. */
export interface MergeCloseOutReport extends PullRequestMergedEvent {
	baseSync: LocalBaseSyncOutcome;
	issue: LinkedIssueCloseOut;
}

/** Collaborators the close-out acts through. */
export interface MergeCloseOutDeps {
	linearService: LinearService;
	localCommandService: LocalCommandService;
	readLinkedIssue: (workspaceId: string) => WorkspaceLinkedIssue | null;
	/**
	 * Fast-forwards the local copy of a merged workspace's base branch, honouring
	 * the `updateBaseAfterMerge` setting. Must resolve rather than reject.
	 */
	syncLocalBase: (workspaceId: string) => Promise<LocalBaseSyncOutcome>;
	/**
	 * Moves a workspace's board card. Board status is renderer-owned, so this
	 * updates the main-process mirror and broadcasts to every window, the same
	 * way an agent's `setWorkspaceStatus` lands.
	 */
	setBoardStatus: (
		workspaceId: string,
		status: WorkspaceBoardStatusValue,
	) => void;
}

/** Public surface of the merge close-out. */
export interface MergeCloseOutService {
	/**
	 * Closes out one merged pull request, once per session: a repeat call for the
	 * same pull request resolves to the first call's report, so a caller that
	 * merged it can await the close-out the merge listener already started.
	 * Never rejects.
	 */
	closeOut: (event: PullRequestMergedEvent) => Promise<MergeCloseOutReport>;
}

const GH_TIMEOUT_MS = 45_000;
const GH_MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * A GitHub issue URL on any host. Checked before the URL is handed to `gh`, so a
 * hand-edited metadata row cannot smuggle in a value `gh` would read as a flag.
 */
const GITHUB_ISSUE_URL_PATTERN =
	/^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/issues\/\d+$/;

/** How `gh issue close` reports an issue it found closed already, on stderr. */
const GH_ALREADY_CLOSED_PATTERN = /already closed/i;

/**
 * The completed state preferred when a team has several. Linear lets a team
 * keep more than one (`Done` beside `Released`, say), and the metadata cache does
 * not carry their board order, so the conventional name wins and the first
 * completed state is the fallback.
 */
const PREFERRED_COMPLETED_STATE_NAME = 'done';

const TERMINAL_STATE_TYPES: ReadonlySet<string> = new Set(
	LINEAR_TERMINAL_STATE_TYPES,
);

const CLOSED: LinkedIssueCloseOut = { status: 'closed' };
const ALREADY_CLOSED: LinkedIssueCloseOut = { status: 'already-closed' };
const NO_LINKED_ISSUE: LinkedIssueCloseOut = { status: 'no-linked-issue' };

/**
 * Builds a failed outcome.
 * @param message - What went wrong, for the log.
 * @returns The failed outcome.
 */
function failed(message: string): LinkedIssueCloseOut {
	return { message, status: 'failed' };
}

/**
 * Picks the state a team marks finished work with, out of one metadata read.
 * @param result - A Linear metadata read for the issue's account.
 * @param teamId - The team that owns the issue.
 * @returns The team's completed state, or null when the read has none for it.
 */
function completedStateOf(
	result: GetLinearMetadataResult,
	teamId: string,
): LinearResourceWire | null {
	const completed = result.metadata.states.filter(
		(state) => state.type === 'completed' && state.teamId === teamId,
	);
	return (
		completed.find(
			(state) =>
				state.name.trim().toLowerCase() === PREFERRED_COMPLETED_STATE_NAME,
		) ??
		completed[0] ??
		null
	);
}

/** Base-sync outcomes that are an ordinary result rather than something to log. */
const QUIET_BASE_SYNC_STATUSES: ReadonlySet<LocalBaseSyncOutcome['status']> =
	new Set(['disabled', 'fast-forwarded', 'up-to-date']);

/**
 * Builds the merge close-out.
 * @param deps - The services and app state the close-out acts through.
 * @returns The close-out service.
 */
export function createMergeCloseOutService({
	linearService,
	localCommandService,
	readLinkedIssue,
	setBoardStatus,
	syncLocalBase,
}: MergeCloseOutDeps): MergeCloseOutService {
	let closeOuts: ReadonlyMap<string, Promise<MergeCloseOutReport>> = new Map();

	/**
	 * Finds the completed state for an issue's team, reading the cached metadata
	 * first and syncing it once when the cache has none — a team created since
	 * the last sync is the usual cause.
	 * @param issue - The issue to close, as Linear reported it.
	 * @returns The team's completed state, or null when it has none.
	 */
	const findCompletedState = async (
		issue: LinearIssueWire,
	): Promise<LinearResourceWire | null> => {
		const { accountId, teamId } = issue;
		if (!teamId) {
			return null;
		}
		const cached = completedStateOf(
			await linearService.getMetadata({ accountId }),
			teamId,
		);
		return (
			cached ??
			completedStateOf(
				await linearService.getMetadata({ accountId, refresh: true }),
				teamId,
			)
		);
	};

	/**
	 * Moves a Linear issue to its team's completed state, leaving one that is
	 * already completed or canceled where it is.
	 * @param linked - The issue the workspace was created from.
	 * @returns What became of it.
	 */
	const closeLinearIssue = async (
		linked: WorkspaceLinkedIssue,
	): Promise<LinkedIssueCloseOut> => {
		const read = await linearService.getIssue({
			...(linked.accountId ? { fallbackAccountId: linked.accountId } : {}),
			id: linked.identifier,
			refresh: true,
		});
		if (read.status === 'error') {
			return failed(read.failure.message);
		}
		if (TERMINAL_STATE_TYPES.has(read.issue.stateType ?? '')) {
			return ALREADY_CLOSED;
		}
		const state = await findCompletedState(read.issue);
		if (!state) {
			return failed(
				`Team ${read.issue.teamKey ?? read.issue.teamId ?? '(unknown)'} has no completed workflow state.`,
			);
		}
		const moved = await linearService.updateIssue({
			accountId: read.issue.accountId,
			id: read.issue.id,
			input: { stateId: state.id },
		});
		return moved.status === 'ok' ? CLOSED : failed(moved.failure.message);
	};

	/**
	 * Closes a GitHub issue as completed. `gh` treats an issue that is closed
	 * already as success, so this needs no read first.
	 * @param linked - The issue the workspace was created from.
	 * @returns What became of it.
	 */
	const closeGithubIssue = async (
		linked: WorkspaceLinkedIssue,
	): Promise<LinkedIssueCloseOut> => {
		if (!linked.url || !GITHUB_ISSUE_URL_PATTERN.test(linked.url)) {
			return failed(`GitHub issue ${linked.identifier} has no usable URL.`);
		}
		const result = await localCommandService.run({
			args: ['issue', 'close', linked.url, '--reason', 'completed'],
			command: 'gh',
			maxOutputBytes: GH_MAX_OUTPUT_BYTES,
			timeoutMs: GH_TIMEOUT_MS,
		});
		if (result.status !== 'success') {
			return failed(
				result.failure?.message ?? (result.stderr.trim() || 'gh failed.'),
			);
		}
		return GH_ALREADY_CLOSED_PATTERN.test(result.stderr)
			? ALREADY_CLOSED
			: CLOSED;
	};

	/**
	 * Closes the issue a workspace was created from, if it has one.
	 * @param workspaceId - The merged workspace.
	 * @returns What became of its linked issue.
	 */
	const closeLinkedIssue = async (
		workspaceId: string,
	): Promise<LinkedIssueCloseOut> => {
		try {
			const linked = readLinkedIssue(workspaceId);
			if (!linked) {
				return NO_LINKED_ISSUE;
			}
			return linked.provider === 'linear'
				? await closeLinearIssue(linked)
				: await closeGithubIssue(linked);
		} catch (cause) {
			return failed(cause instanceof Error ? cause.message : String(cause));
		}
	};

	/**
	 * Moves the merged workspace's board card to Done, logging rather than
	 * throwing so a failed broadcast cannot cost the issue its close.
	 * @param event - The merge being closed out.
	 */
	const moveBoardCardToDone = (event: PullRequestMergedEvent): void => {
		try {
			setBoardStatus(event.workspaceId, 'done');
		} catch (cause) {
			console.warn('[merge-close-out] could not move the board card.', {
				cause,
				pullRequestNumber: event.pullRequestNumber,
				workspaceId: event.workspaceId,
			});
		}
	};

	/**
	 * Fast-forwards the merged workspace's local base branch, turning a rejection
	 * into an outcome so it cannot cost the issue its close.
	 * @param event - The merge being closed out.
	 * @returns What became of the local base branch.
	 */
	const syncBase = async (
		event: PullRequestMergedEvent,
	): Promise<LocalBaseSyncOutcome> => {
		const outcome = await syncLocalBase(event.workspaceId).catch(
			(cause: unknown): LocalBaseSyncOutcome => ({
				detail: cause instanceof Error ? cause.message : String(cause),
				status: 'unavailable',
			}),
		);
		if (!QUIET_BASE_SYNC_STATUSES.has(outcome.status)) {
			console.warn('[merge-close-out] left the local base branch as it was.', {
				outcome,
				pullRequestNumber: event.pullRequestNumber,
				workspaceId: event.workspaceId,
			});
		}
		return outcome;
	};

	/**
	 * Runs every close-out step for one merge.
	 * @param event - The merge being closed out.
	 * @returns What each step did.
	 */
	const runCloseOut = async (
		event: PullRequestMergedEvent,
	): Promise<MergeCloseOutReport> => {
		moveBoardCardToDone(event);
		const [issue, baseSync] = await Promise.all([
			closeLinkedIssue(event.workspaceId),
			syncBase(event),
		]);
		if (issue.status === 'failed') {
			console.warn('[merge-close-out] could not close the linked issue.', {
				message: issue.message,
				pullRequestNumber: event.pullRequestNumber,
				workspaceId: event.workspaceId,
			});
		}
		return { ...event, baseSync, issue };
	};

	return {
		closeOut: (event) => {
			const key = `${event.workspaceId}#${event.pullRequestNumber}`;
			const started = closeOuts.get(key);
			if (started) {
				return started;
			}
			const closeOut = runCloseOut(event);
			closeOuts = new Map([...closeOuts, [key, closeOut]]);
			return closeOut;
		},
	};
}
