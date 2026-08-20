import type { DatabaseSync } from 'node:sqlite';

import type { GithubCheckWire } from '../../shared/ipc/contracts/github';
import {
	type ActiveWorkspacePrCheckRow,
	listActiveWorkspacePrCheckRows,
} from '../storage/repositories/workspace-repository.ts';
import type { SweepableWorkspace } from './workspace-pr-sweeper.ts';

/**
 * Lists every non-archived workspace for the PR-status sweeper, tagging the ones
 * whose cached snapshot still shows a check in flight. That tag is what lets the
 * sweeper spend its short cadence on the rows whose status is about to change,
 * and the whole listing costs one joined query however many workspaces exist.
 * @param database - The open database connection.
 * @returns One entry per active workspace, in listing order.
 */
export function listSweepableWorkspaces({
	database,
}: {
	database: DatabaseSync;
}): SweepableWorkspace[] {
	return listActiveWorkspacePrCheckRows({ database }).map((row) => ({
		hasPendingChecks: hasPendingChecks(row),
		id: row.id,
		path: row.path,
	}));
}

/**
 * Whether a workspace's cached snapshot holds an open pull request with at least
 * one check still running.
 * @param row - One joined workspace row from the sweeper listing.
 * @returns True when a check on an open pull request has not finished.
 */
function hasPendingChecks(row: ActiveWorkspacePrCheckRow): boolean {
	if (row.pullRequestState !== 'open' || !row.checksJson) {
		return false;
	}
	return parseChecks(row.checksJson).some(
		(check) => check.bucket === 'pending',
	);
}

/**
 * Parses the checks slice the listing extracted, tolerating anything that is not
 * an array so one unreadable cache row cannot break the sweep's scheduling.
 * @param checksJson - The cached pull request's `checks` array, JSON-encoded.
 * @returns The parsed checks, or an empty list when unreadable.
 */
function parseChecks(checksJson: string): readonly GithubCheckWire[] {
	try {
		const parsed = JSON.parse(checksJson) as unknown;
		return Array.isArray(parsed) ? (parsed as GithubCheckWire[]) : [];
	} catch {
		return [];
	}
}
