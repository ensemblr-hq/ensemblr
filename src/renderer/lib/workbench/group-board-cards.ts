/**
 * Buckets the dashboard board's cards into their columns.
 *
 * Imported by path rather than through `lib/workbench/index.ts` — see the note
 * at the top of `board-issues.ts` for why the board modules stay out of that
 * barrel.
 */

import {
	BOARD_STATUS_ORDER,
	orderColumnWorkspaceIds,
	resolveBoardStatus,
	type WorkspaceBoardStatus,
} from '@/renderer/state/workspace';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type {
	BoardCard,
	BoardIssueCard,
} from '@/renderer/types/workbench-shell';

/** Inputs {@link groupBoardCards} buckets into one list per board column. */
export interface GroupBoardCardsInput {
	backlogIssues: readonly BoardIssueCard[];
	/** Issues the user dismissed; they join the workspaces in the Canceled column. */
	dismissedIssues: readonly BoardIssueCard[];
	/** Persisted global board order of workspace ids, used within each column. */
	order: readonly string[];
	projects: readonly ProjectShellModel[];
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>;
}

/**
 * Turns an issue card into a board card.
 * @param issue - The issue to wrap.
 * @returns The board card for it.
 */
function toIssueCard(issue: BoardIssueCard): BoardCard {
	return { issue, kind: 'issue' };
}

/**
 * Buckets every board card into its column: Backlog holds the issue cards, which
 * by definition have no workspace, and each other column holds the workspaces
 * with that status, sorted by the persisted board order. Dismissed issues join
 * the workspaces in Canceled so the dismissal stays visible and undoable — they
 * trail them here, though a non-manual sort in {@link filterBoardCards} reorders
 * the column afterwards and may interleave the two. Optimistic rows the create
 * call has not confirmed yet are skipped so a card does not flicker in and out
 * as the real workspace lands.
 * @param input - Issues, projects, the status map, and the board order.
 * @returns One card list per board status, in column order.
 */
export function groupBoardCards({
	backlogIssues,
	dismissedIssues,
	order,
	projects,
	statusByWorkspaceId,
}: GroupBoardCardsInput): Record<WorkspaceBoardStatus, BoardCard[]> {
	const workspaceCardsById = new Map<string, BoardCard>();
	const workspaceIdsByStatus = new Map<WorkspaceBoardStatus, string[]>(
		BOARD_STATUS_ORDER.map((status) => [status, []]),
	);

	for (const project of projects) {
		for (const workspace of project.workspaces) {
			if (workspace.isPendingCreation === true) {
				continue;
			}
			workspaceCardsById.set(workspace.id, {
				kind: 'workspace',
				project,
				workspace,
			});
			workspaceIdsByStatus
				.get(resolveBoardStatus(statusByWorkspaceId, workspace.id))
				?.push(workspace.id);
		}
	}

	return Object.fromEntries(
		BOARD_STATUS_ORDER.map((status) => {
			if (status === 'backlog') {
				return [status, backlogIssues.map(toIssueCard)];
			}
			const workspaceCards = orderColumnWorkspaceIds(
				order,
				workspaceIdsByStatus.get(status) ?? [],
			).flatMap((id) => {
				const card = workspaceCardsById.get(id);
				return card ? [card] : [];
			});
			return [
				status,
				status === 'canceled'
					? [...workspaceCards, ...dismissedIssues.map(toIssueCard)]
					: workspaceCards,
			];
		}),
	) as Record<WorkspaceBoardStatus, BoardCard[]>;
}
