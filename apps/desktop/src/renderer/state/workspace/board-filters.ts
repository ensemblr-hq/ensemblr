import { useAtom } from 'jotai';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';
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
 * The board's toolbar state. Empty `assignees`, `repoIds`, and `sources` mean
 * "no narrowing" rather than "nothing matches", so a fresh install shows every
 * card. `assignees` narrows Linear issue cards only, by Linear user id or the
 * `me`/`unassigned` tokens.
 */
export interface BoardFilters {
	assignees: string[];
	query: string;
	repoIds: string[];
	sort: BoardSortMode;
	sources: BoardCardSource[];
}

/** Unfiltered board, ordered by the user's own drag order. */
export const DEFAULT_BOARD_FILTERS: BoardFilters = {
	assignees: [],
	query: '',
	repoIds: [],
	sort: 'manual',
	sources: [],
};

const boardFiltersStorage = createJSONStorage<BoardFilters>();

/**
 * Whether a stored field is absent or an array of strings.
 * @param field - One field of the decoded value
 * @returns True when the field may be spread over the defaults
 */
function isOptionalStringArray(field: unknown): boolean {
	return (
		field === undefined ||
		(Array.isArray(field) && field.every((entry) => typeof entry === 'string'))
	);
}

/**
 * Whether a value decoded from local storage can be read as stored board
 * filters. Every field is optional, because a value written before a field
 * existed lacks it and spreading over the defaults fills the gap.
 * @param value - Whatever JSON decoded to
 * @returns Whether each field it does carry has its expected type
 */
function isStoredBoardFilters(value: unknown): value is Partial<BoardFilters> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}

	const candidate = value as Record<string, unknown>;

	return (
		(candidate.query === undefined || typeof candidate.query === 'string') &&
		(candidate.sort === undefined ||
			BOARD_SORT_MODES.includes(candidate.sort as BoardSortMode)) &&
		isOptionalStringArray(candidate.assignees) &&
		isOptionalStringArray(candidate.repoIds) &&
		isOptionalStringArray(candidate.sources)
	);
}

/**
 * Persisted dashboard toolbar state (search, facets, sort). The stored value is
 * validated and laid over the defaults on the way in, because `getOnInit` puts
 * it into the first render: a value written before the assignee facet existed
 * would otherwise reach the toolbar without an `assignees` array.
 */
export const boardFiltersAtom = atomWithStorage<BoardFilters>(
	'ensemblr_dashboard_board_filters',
	DEFAULT_BOARD_FILTERS,
	{
		...boardFiltersStorage,
		/**
		 * Reads the stored filters, falling back to the defaults for anything that
		 * does not decode to the expected shape.
		 * @param key - The storage key being read
		 * @param initialValue - The value to assume when nothing is stored
		 * @returns Filters safe to render
		 */
		getItem: (key, initialValue) => {
			const stored = boardFiltersStorage.getItem(key, initialValue);

			return isStoredBoardFilters(stored)
				? { ...DEFAULT_BOARD_FILTERS, ...stored }
				: DEFAULT_BOARD_FILTERS;
		},
	},
	{ getOnInit: true },
);

/** The board filters plus the setters the toolbar controls bind to. */
export interface BoardFiltersState {
	clear: () => void;
	filters: BoardFilters;
	setQuery: (query: string) => void;
	setSort: (sort: BoardSortMode) => void;
	toggleAssignee: (entry: string) => void;
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
	const toggleAssignee = useCallback(
		(entry: string) =>
			setFilters((current) => ({
				...current,
				assignees: toggleValue(current.assignees, entry),
			})),
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
		() => ({
			clear,
			filters,
			setQuery,
			setSort,
			toggleAssignee,
			toggleRepo,
			toggleSource,
		}),
		[
			clear,
			filters,
			setQuery,
			setSort,
			toggleAssignee,
			toggleRepo,
			toggleSource,
		],
	);
}
