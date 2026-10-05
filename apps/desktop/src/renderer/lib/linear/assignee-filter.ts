import type {
	LinearIssueWire,
	LinearResourceWire,
} from '@/shared/ipc/contracts/linear';

/**
 * Selection token for "issues assigned to me": whichever connected account's
 * own Linear user an issue is assigned to. A token rather than a user id, so the
 * stored filter keeps meaning the user across a reconnect, and across several
 * organizations where the same person is a different Linear user in each.
 */
export const LINEAR_ASSIGNEE_ME = 'me';

/** Selection token for an issue nobody is assigned to. */
export const LINEAR_ASSIGNEE_UNASSIGNED = 'unassigned';

/** One person the assignee facet can narrow to, other than the user themself. */
export interface LinearAssigneeOption {
	id: string;
	/** Null when neither a loaded issue nor the cached members name this id. */
	name: string | null;
	organizationName: string | null;
}

/**
 * Whether a selection entry names a specific Linear user rather than one of the
 * two tokens.
 * @param entry - One entry of an assignee selection
 * @returns True when the entry is a Linear user id
 */
export function isLinearAssigneePerson(entry: string): boolean {
	return entry !== LINEAR_ASSIGNEE_ME && entry !== LINEAR_ASSIGNEE_UNASSIGNED;
}

/**
 * Whether a value decoded from local storage can be read as an assignee
 * selection, which every persisted Linear filter carries.
 * @param value - Whatever JSON decoded to
 * @returns Whether it is an array of strings
 */
export function isLinearAssigneeSelection(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === 'string')
	);
}

/**
 * Immutably adds or removes one entry from an assignee selection.
 * @param selection - The current selection
 * @param entry - A token or Linear user id the user clicked
 * @returns The next selection
 */
export function toggleLinearAssignee(
	selection: readonly string[],
	entry: string,
): string[] {
	return selection.includes(entry)
		? selection.filter((candidate) => candidate !== entry)
		: [...selection, entry];
}

/**
 * Builds the test an issue must pass to survive an assignee selection. An empty
 * selection narrows nothing; otherwise an issue survives when any one entry
 * takes it, so "me" plus "unassigned" reads as everything nobody else holds.
 * @param selection - The tokens and user ids the facet has selected
 * @param viewerIds - The Linear user id of every connected account
 * @returns A predicate over issues
 */
export function createLinearAssigneeMatcher(
	selection: readonly string[],
	viewerIds: readonly string[],
): (issue: Pick<LinearIssueWire, 'assigneeId'>) => boolean {
	if (selection.length === 0) {
		return () => true;
	}

	const viewers = new Set(viewerIds);
	const people = new Set(selection.filter(isLinearAssigneePerson));
	const takesMine = selection.includes(LINEAR_ASSIGNEE_ME);
	const takesUnassigned = selection.includes(LINEAR_ASSIGNEE_UNASSIGNED);

	return ({ assigneeId }) =>
		assigneeId === null
			? takesUnassigned
			: people.has(assigneeId) || (takesMine && viewers.has(assigneeId));
}

/**
 * The people the assignee facet offers: everyone some loaded issue is assigned
 * to, plus anyone already selected, so a selection whose issues have all gone
 * stays visible and can still be cleared. The user's own accounts are left out
 * because the "me" token already covers them. Named from the issues first and
 * the cached members second, ordered by name with the unnamed last.
 * @param options - The unfiltered issues, the current selection, the connected accounts' user ids, and the cached members if loaded
 * @returns The person options, deduplicated by id
 */
export function listLinearAssigneeOptions({
	issues,
	selection,
	users,
	viewerIds,
}: {
	issues: readonly LinearIssueWire[];
	selection: readonly string[];
	users: readonly LinearResourceWire[] | undefined;
	viewerIds: readonly string[];
}): LinearAssigneeOption[] {
	const viewers = new Set(viewerIds);
	const known = new Map<string, LinearAssigneeOption>();

	for (const user of users ?? []) {
		known.set(user.id, {
			id: user.id,
			name: user.name || null,
			organizationName: user.organizationName,
		});
	}

	const options = new Map<string, LinearAssigneeOption>();

	for (const issue of issues) {
		if (issue.assigneeId !== null && !viewers.has(issue.assigneeId)) {
			options.set(issue.assigneeId, {
				id: issue.assigneeId,
				name: issue.assigneeName ?? known.get(issue.assigneeId)?.name ?? null,
				organizationName: issue.organizationName,
			});
		}
	}

	for (const id of selection.filter(isLinearAssigneePerson)) {
		if (!options.has(id) && !viewers.has(id)) {
			options.set(
				id,
				known.get(id) ?? { id, name: null, organizationName: null },
			);
		}
	}

	return [...options.values()].sort(compareAssigneeOptions);
}

/**
 * Orders person options alphabetically by name, unnamed ones last.
 * @param left - First option
 * @param right - Second option
 * @returns A comparator result
 */
function compareAssigneeOptions(
	left: LinearAssigneeOption,
	right: LinearAssigneeOption,
): number {
	if (left.name === null || right.name === null) {
		return Number(left.name === null) - Number(right.name === null);
	}

	return left.name.localeCompare(right.name);
}
