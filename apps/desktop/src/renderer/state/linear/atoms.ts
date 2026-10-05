import { atomWithStorage, createJSONStorage } from 'jotai/utils';

import {
	isLinearAssigneeSelection,
	type LinearIssueGrouping,
	type LinearIssueScope,
	type LinearIssueSort,
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

const assigneeSelectionStorage = createJSONStorage<string[]>();

/**
 * Assignee selection of the create-from picker's Issues tab, apart from the
 * browse list's and the board's so narrowing one surface never quietly narrows
 * another. Persisted, and validated on the way in for the same reason the
 * browse filters are: `getOnInit` puts the stored value into the first render.
 */
export const linearSourcePickerAssigneesAtom = atomWithStorage<string[]>(
	KEY('source_picker_assignees'),
	[],
	{
		...assigneeSelectionStorage,
		/**
		 * Reads the stored selection, falling back to none when it does not decode
		 * to an array of strings.
		 * @param key - The storage key being read
		 * @param initialValue - The value to assume when nothing is stored
		 * @returns A selection safe to render
		 */
		getItem: (key, initialValue) => {
			const stored = assigneeSelectionStorage.getItem(key, initialValue);

			return isLinearAssigneeSelection(stored) ? stored : [];
		},
	},
	{ getOnInit: true },
);
