import { useAtom } from 'jotai';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';
import { useCallback, useMemo } from 'react';

import {
	ALL_TEAMS,
	DEFAULT_LINEAR_ISSUE_FILTERS,
	type LinearIssueFilters,
} from '@/renderer/lib/linear';
import { KEY } from './atoms';

/** localStorage key holding the persisted Linear browse filters. */
export const LINEAR_ISSUE_FILTERS_STORAGE_KEY = KEY('filters');

const filtersStorage = createJSONStorage<LinearIssueFilters>();

/**
 * Whether a value decoded from local storage can be read as stored filters.
 * Every field is optional here: a value written by an older build predates any
 * field added since, and spreading it over the defaults is what fills the gap.
 * @param value - Whatever JSON decoded to
 * @returns Whether each field it does carry is a string
 */
function isStoredFilters(
	value: unknown,
): value is Partial<Record<keyof LinearIssueFilters, string>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}

	const candidate = value as Record<string, unknown>;

	return (['accountId', 'query', 'teamId'] as const).every(
		(field) =>
			candidate[field] === undefined || typeof candidate[field] === 'string',
	);
}

/**
 * Filter bar state of the Linear browse list — search text, account, and team.
 * Persisted so leaving the list for an issue and coming back lands on the same
 * narrowed set rather than resetting to every issue in every organization.
 * `getOnInit` keeps a cold start from rendering the unfiltered list for a frame
 * before the stored value arrives, which would fire the issue query twice.
 *
 * The stored value is validated on the way in rather than trusted: `getOnInit`
 * puts it into the very first render, so a value of the wrong shape — written
 * by another build, or a field this type has since gained — would otherwise
 * throw where the filters are read instead of degrading to the defaults.
 */
export const linearIssueFiltersAtom = atomWithStorage<LinearIssueFilters>(
	LINEAR_ISSUE_FILTERS_STORAGE_KEY,
	DEFAULT_LINEAR_ISSUE_FILTERS,
	{
		...filtersStorage,
		/**
		 * Reads the stored filters, falling back to the defaults for anything that
		 * does not decode to the expected shape.
		 * @param key - The storage key being read
		 * @param initialValue - The value to assume when nothing is stored
		 * @returns Filters safe to render
		 */
		getItem: (key, initialValue) => {
			const stored = filtersStorage.getItem(key, initialValue);

			return isStoredFilters(stored)
				? { ...DEFAULT_LINEAR_ISSUE_FILTERS, ...stored }
				: DEFAULT_LINEAR_ISSUE_FILTERS;
		},
	},
	{ getOnInit: true },
);

/** The Linear browse filters plus the setters the filter bar binds to. */
export interface LinearIssueFiltersState {
	clear: () => void;
	filters: LinearIssueFilters;
	setAccountId: (accountId: string) => void;
	setQuery: (query: string) => void;
	setTeamId: (teamId: string) => void;
}

/**
 * Reads and writes the persisted filter bar state of the Linear browse list.
 * Switching account clears the team, because a team belongs to exactly one
 * account and the old selection would narrow the list to nothing.
 * @returns The current filters plus stable setters for each control.
 */
export function useLinearIssueFilters(): LinearIssueFiltersState {
	const [filters, setFilters] = useAtom(linearIssueFiltersAtom);

	const setQuery = useCallback(
		(query: string) => setFilters((current) => ({ ...current, query })),
		[setFilters],
	);
	const setAccountId = useCallback(
		(accountId: string) =>
			setFilters((current) => ({ ...current, accountId, teamId: ALL_TEAMS })),
		[setFilters],
	);
	const setTeamId = useCallback(
		(teamId: string) => setFilters((current) => ({ ...current, teamId })),
		[setFilters],
	);
	const clear = useCallback(
		() => setFilters(DEFAULT_LINEAR_ISSUE_FILTERS),
		[setFilters],
	);

	return useMemo(
		() => ({ clear, filters, setAccountId, setQuery, setTeamId }),
		[clear, filters, setAccountId, setQuery, setTeamId],
	);
}
