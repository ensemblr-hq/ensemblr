/**
 * Applies the dashboard toolbar's facets and sort to a board column.
 *
 * Imported by path rather than through `lib/workbench/index.ts` — see the note
 * at the top of `board-issues.ts` for why the board modules stay out of that
 * barrel.
 */

import { linearPriorityRank } from '@/renderer/lib/linear';
import type { BoardCardSource, BoardFilters } from '@/renderer/state/workspace';
import type { BoardCard } from '@/renderer/types/workbench-shell';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

/** Rank given to a card with no priority of its own, matching Linear's "none". */
const UNPRIORITIZED_RANK = linearPriorityRank(null);

/** The assignee facet's test over one Linear issue. */
type LinearAssigneePredicate = (
	issue: Pick<LinearIssueWire, 'assigneeId'>,
) => boolean;

/**
 * Which facet value a card answers to.
 * @param card - The card to classify.
 * @returns Its source facet value.
 */
function cardSource(card: BoardCard): BoardCardSource {
	return card.kind === 'workspace' ? 'workspace' : card.issue.provider;
}

/**
 * The repositories a card belongs to, or null when it is not repo-scoped — a
 * Linear issue is not, unless some repository's `[linear]` block names its
 * teams, and then it belongs to every repository whose scope takes it.
 * @param card - The card to locate.
 * @returns The repository ids, or null.
 */
function cardRepoIds(card: BoardCard): readonly string[] | null {
	if (card.kind === 'workspace') {
		return [card.project.id];
	}
	return card.issue.projectId === null
		? card.issue.scopeRepoIds
		: [card.issue.projectId];
}

/**
 * Every string a free-text search should match a card on.
 * @param card - The card to describe.
 * @returns The searchable fragments, unnormalized.
 */
function cardSearchFields(card: BoardCard): (string | null | undefined)[] {
	if (card.kind === 'workspace') {
		return [card.workspace.name, card.workspace.branchName, card.project.name];
	}
	return [
		card.issue.title,
		card.issue.reference,
		card.issue.subtitle,
		card.issue.trackerProject,
		...card.issue.labels,
	];
}

/**
 * Timestamp the "recently updated" sort orders a card by.
 * @param card - The card to date.
 * @returns Milliseconds since the epoch, or null when the card carries no date.
 */
function cardUpdatedAt(card: BoardCard): number | null {
	const raw =
		card.kind === 'workspace' ? card.workspace.updatedAt : card.issue.updatedAt;
	if (!raw) {
		return null;
	}
	const parsed = Date.parse(raw);
	return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Priority rank a card sorts by; workspaces and GitHub issues have none and tie
 * at the bottom, where the stable sort leaves them in their manual order.
 * @param card - The card to rank.
 * @returns The rank, urgent first.
 */
function cardPriorityRank(card: BoardCard): number {
	return card.kind === 'issue'
		? linearPriorityRank(card.issue.priority)
		: UNPRIORITIZED_RANK;
}

/**
 * Whether a card survives the repository facet. The facet never hides a card
 * that belongs to no repository — an unscoped Linear issue — since dropping it
 * would empty the Backlog column the moment any repository is picked.
 * @param card - The card to test.
 * @param pickedRepoIds - The repositories the facet picks; empty when it picks none.
 * @returns True when the card stays under the picked repositories.
 */
function matchesPickedRepos(
	card: BoardCard,
	pickedRepoIds: ReadonlySet<string>,
): boolean {
	const repoIds = cardRepoIds(card);
	return (
		pickedRepoIds.size === 0 ||
		repoIds === null ||
		repoIds.some((repoId) => pickedRepoIds.has(repoId))
	);
}

/**
 * Whether a card survives the assignee facet, which only a Linear issue card
 * answers to: a workspace has no assignee, and the GitHub cards on the board are
 * unassigned by construction, so neither is the clutter the facet removes.
 * @param card - The card to test.
 * @param matchesLinearAssignee - The facet's predicate over Linear issues.
 * @returns True when the card stays under the facet.
 */
function matchesAssignee(
	card: BoardCard,
	matchesLinearAssignee: LinearAssigneePredicate,
): boolean {
	return card.kind === 'issue' && card.issue.item.kind === 'linear-issue'
		? matchesLinearAssignee(card.issue.item.issue)
		: true;
}

/**
 * Whether a card survives the toolbar's facets and search.
 * @param card - The card to test.
 * @param filters - The active toolbar state.
 * @param pickedRepoIds - `filters.repoIds` as a set, built once per column.
 * @param matchesLinearAssignee - The assignee facet's predicate over Linear issues.
 * @returns True when the card should stay on the board.
 */
function matchesFilters(
	card: BoardCard,
	filters: BoardFilters,
	pickedRepoIds: ReadonlySet<string>,
	matchesLinearAssignee: LinearAssigneePredicate,
): boolean {
	if (
		filters.sources.length > 0 &&
		!filters.sources.includes(cardSource(card))
	) {
		return false;
	}
	if (!matchesPickedRepos(card, pickedRepoIds)) {
		return false;
	}
	if (!matchesAssignee(card, matchesLinearAssignee)) {
		return false;
	}
	const query = filters.query.trim().toLowerCase();
	if (!query) {
		return true;
	}
	return cardSearchFields(card).some((field) =>
		(field ?? '').toLowerCase().includes(query),
	);
}

/**
 * Compares two cards under the active sort. `manual` keeps the order the caller
 * handed in — for workspaces that is the user's own drag order, which the
 * grouper already applied.
 * @param left - First card.
 * @param right - Second card.
 * @param sort - Active sort mode.
 * @returns A comparator result.
 */
function compareCards(
	left: BoardCard,
	right: BoardCard,
	sort: BoardFilters['sort'],
): number {
	if (sort === 'priority') {
		return cardPriorityRank(left) - cardPriorityRank(right);
	}
	if (sort === 'updated') {
		return (
			(cardUpdatedAt(right) ?? Number.NEGATIVE_INFINITY) -
			(cardUpdatedAt(left) ?? Number.NEGATIVE_INFINITY)
		);
	}
	return 0;
}

/**
 * Applies the dashboard toolbar to one column's cards: drops what the facets and
 * the search exclude, then reorders what remains. The assignee facet arrives as
 * a predicate built from `filters.assignees`, because resolving its "me" token
 * needs the connected Linear accounts, which the toolbar state does not hold.
 * @param cards - The column's cards, already in manual order.
 * @param filters - The active toolbar state.
 * @param matchesLinearAssignee - The assignee facet's predicate over Linear issues; keeps every issue when omitted.
 * @returns A new, filtered and sorted card list.
 */
export function filterBoardCards(
	cards: readonly BoardCard[],
	filters: BoardFilters,
	matchesLinearAssignee: LinearAssigneePredicate = () => true,
): BoardCard[] {
	const pickedRepoIds = new Set(filters.repoIds);
	return cards
		.filter((card) =>
			matchesFilters(card, filters, pickedRepoIds, matchesLinearAssignee),
		)
		.sort((left, right) => compareCards(left, right, filters.sort));
}
