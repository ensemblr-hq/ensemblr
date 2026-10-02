import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useCallback, useMemo } from 'react';

/** Where a board card came from, as the toolbar's source facet names it. */
export type BoardCardSource = 'github' | 'linear' | 'workspace';

/** Every source the board's source facet can be narrowed to. */
export const BOARD_CARD_SOURCES: readonly BoardCardSource[] = [
	'workspace',
	'linear',
	'github',
];

/** How the board orders the cards inside each column. */
export type BoardSortMode = 'manual' | 'priority' | 'updated';

/** Every sort mode the board's sort control offers, in menu order. */
export const BOARD_SORT_MODES: readonly BoardSortMode[] = [
	'manual',
	'updated',
	'priority',
];

/**
 * The board's toolbar state. Empty `repoIds` and `sources` mean "no narrowing"
 * rather than "nothing matches", so a fresh install shows every card.
 */
export interface BoardFilters {
	query: string;
	repoIds: string[];
	sort: BoardSortMode;
	sources: BoardCardSource[];
}

/** Unfiltered board, ordered by the user's own drag order. */
export const DEFAULT_BOARD_FILTERS: BoardFilters = {
	query: '',
	repoIds: [],
	sort: 'manual',
	sources: [],
};

/** Persisted dashboard toolbar state (search, facets, sort). */
export const boardFiltersAtom = atomWithStorage<BoardFilters>(
	'ensemblr_dashboard_board_filters',
	DEFAULT_BOARD_FILTERS,
	undefined,
	{ getOnInit: true },
);

/** The board filters plus the setters the toolbar controls bind to. */
export interface BoardFiltersState {
	clear: () => void;
	filters: BoardFilters;
	setQuery: (query: string) => void;
	setSort: (sort: BoardSortMode) => void;
	toggleRepo: (repoId: string) => void;
	toggleSource: (source: BoardCardSource) => void;
}

/**
 * Immutably adds or removes one value from a facet's selection.
 * @param values - Current selection.
 * @param value - Value the user clicked.
 * @returns The next selection.
 */
function toggleValue<Value>(values: readonly Value[], value: Value): Value[] {
	return values.includes(value)
		? values.filter((candidate) => candidate !== value)
		: [...values, value];
}

/**
 * Reads and writes the persisted dashboard toolbar state.
 * @returns The current filters plus stable setters for each control.
 */
export function useBoardFilters(): BoardFiltersState {
	const [filters, setFilters] = useAtom(boardFiltersAtom);

	const setQuery = useCallback(
		(query: string) => setFilters((current) => ({ ...current, query })),
		[setFilters],
	);
	const setSort = useCallback(
		(sort: BoardSortMode) => setFilters((current) => ({ ...current, sort })),
		[setFilters],
	);
	const toggleRepo = useCallback(
		(repoId: string) =>
			setFilters((current) => ({
				...current,
				repoIds: toggleValue(current.repoIds, repoId),
			})),
		[setFilters],
	);
	const toggleSource = useCallback(
		(source: BoardCardSource) =>
			setFilters((current) => ({
				...current,
				sources: toggleValue(current.sources, source),
			})),
		[setFilters],
	);
	const clear = useCallback(
		() => setFilters(DEFAULT_BOARD_FILTERS),
		[setFilters],
	);

	return useMemo(
		() => ({ clear, filters, setQuery, setSort, toggleRepo, toggleSource }),
		[clear, filters, setQuery, setSort, toggleRepo, toggleSource],
	);
}
