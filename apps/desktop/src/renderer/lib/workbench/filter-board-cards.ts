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

/** Rank given to a card with no priority of its own, matching Linear's "none". */
const UNPRIORITIZED_RANK = linearPriorityRank(null);

/**
 * Which facet value a card answers to.
 * @param card - The card to classify.
 * @returns Its source facet value.
 */
function cardSource(card: BoardCard): BoardCardSource {
	return card.kind === 'workspace' ? 'workspace' : card.issue.provider;
}

/**
 * The repository a card belongs to, or null when it is not repo-scoped — which
 * a Linear issue never is.
 * @param card - The card to locate.
 * @returns The repository id, or null.
 */
function cardRepoId(card: BoardCard): string | null {
	return card.kind === 'workspace' ? card.project.id : card.issue.projectId;
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
 * Whether a card survives the toolbar's facets. A repo filter never hides a card
 * that belongs to no repository — a Linear issue is not repo-scoped, and dropping
 * it would empty the Backlog column the moment any repository is picked.
 * @param card - The card to test.
 * @param filters - The active toolbar state.
 * @returns True when the card should stay on the board.
 */
function matchesFilters(card: BoardCard, filters: BoardFilters): boolean {
	if (
		filters.sources.length > 0 &&
		!filters.sources.includes(cardSource(card))
	) {
		return false;
	}
	const repoId = cardRepoId(card);
	if (
		filters.repoIds.length > 0 &&
		repoId !== null &&
		!filters.repoIds.includes(repoId)
	) {
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
 * the search exclude, then reorders what remains.
 * @param cards - The column's cards, already in manual order.
 * @param filters - The active toolbar state.
 * @returns A new, filtered and sorted card list.
 */
export function filterBoardCards(
	cards: readonly BoardCard[],
	filters: BoardFilters,
): BoardCard[] {
	return cards
		.filter((card) => matchesFilters(card, filters))
		.sort((left, right) => compareCards(left, right, filters.sort));
}
