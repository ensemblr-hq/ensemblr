import type { DatabaseSync } from 'node:sqlite';

import { parseWorkspacePrUnsettled } from '../../shared/github-pr-presentation.ts';
import { listActiveWorkspacePrStatusRows } from '../storage/repositories/workspace-repository.ts';
import type { SweepableWorkspace } from './workspace-pr-sweeper.ts';

/**
 * Lists every non-archived workspace for the PR-status sweeper, tagging the ones
 * whose cached snapshot still reads as unsettled. That tag is what lets the
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
	return listActiveWorkspacePrStatusRows({ database }).map((row) => ({
		hasUnsettledStatus: parseWorkspacePrUnsettled(row.snapshotJson),
		id: row.id,
		path: row.path,
	}));
}
