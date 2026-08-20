import { atomWithStorage } from 'jotai/utils';

import type {
	LinearIssueGrouping,
	LinearIssueScope,
	LinearIssueSort,
} from '@/renderer/lib/linear';

/**
 * Namespaces one browse-list preference in local storage, keeping these keys
 * apart from every other persisted atom.
 * @param suffix - Name of the preference being stored
 * @returns The prefixed storage key
 */
export const KEY = (suffix: string) => `ensemblr_linear_${suffix}`;

/**
 * Completion scope of the Linear browse list. Defaults to active work: a tracker
 * that has been running a while is mostly closed issues, and opening on them
 * buries everything the user can still act on.
 */
export const linearIssueScopeAtom = atomWithStorage<LinearIssueScope>(
	KEY('scope'),
	'active',
);

/** Ordering applied inside every section of the Linear browse list. */
export const linearIssueSortAtom = atomWithStorage<LinearIssueSort>(
	KEY('sort'),
	'priority',
);

/**
 * Field the Linear browse list groups by. Status is the default because it is
 * the axis a tracker is read along — one flat list of mixed states is the state
 * this screen is worst in.
 */
export const linearIssueGroupingAtom = atomWithStorage<LinearIssueGrouping>(
	KEY('grouping'),
	'status',
);
