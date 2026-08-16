import { i18n } from '@/renderer/lib/i18n';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

import { getLinearPriorityLabel } from './issue-view';

/** Ordering applied to issues inside every group of the browse list. */
export type LinearIssueSort = 'priority' | 'status' | 'title' | 'updated';

/** Field the browse list buckets issues by before ordering them. */
export type LinearIssueGrouping = 'assignee' | 'none' | 'priority' | 'status';

/** Coarse completion filter applied before grouping and sorting. */
export type LinearIssueScope = 'active' | 'all' | 'closed';

/**
 * Workflow-state buckets normalized across teams. A team names its states
 * freely, so two teams' "QA" columns only line up through Linear's `stateType`.
 */
export type LinearStateBucket =
	| 'backlog'
	| 'canceled'
	| 'completed'
	| 'started'
	| 'triage'
	| 'unstarted';

/** One rendered section of the browse list. */
export interface LinearIssueGroup {
	id: string;
	issues: LinearIssueWire[];
	/** Null when the list is ungrouped, so the section renders without a header. */
	label: string | null;
	/** Priority number when grouped by priority, so the header can draw its glyph. */
	priority: number | null;
	/** State bucket when grouped by status, so the header can draw its glyph. */
	stateBucket: LinearStateBucket | null;
}

/** The browse list's issues bucketed into sections, plus the visible total. */
export interface LinearIssueBoard {
	groups: LinearIssueGroup[];
	total: number;
}

/** State buckets in the order a tracker reads top to bottom: live work first. */
const STATE_BUCKET_ORDER: readonly LinearStateBucket[] = [
	'triage',
	'started',
	'unstarted',
	'backlog',
	'completed',
	'canceled',
];

/** Priority numbers in descending urgency, with "no priority" last. */
export const LINEAR_PRIORITY_ORDER: readonly number[] = [1, 2, 3, 4, 0];

const CLOSED_BUCKETS: readonly LinearStateBucket[] = ['canceled', 'completed'];

const UNASSIGNED_GROUP_ID = 'unassigned';

/**
 * Normalizes an issue's Linear `stateType` into a bucket. Anything unrecognized
 * counts as unstarted rather than disappearing from a grouped list.
 * @param issue - The issue whose workflow state to bucket
 * @returns The normalized bucket
 */
export function resolveLinearStateBucket(
	issue: Pick<LinearIssueWire, 'stateType'>,
): LinearStateBucket {
	switch (issue.stateType) {
		case 'backlog':
			return 'backlog';
		case 'canceled':
			return 'canceled';
		case 'completed':
			return 'completed';
		case 'started':
			return 'started';
		case 'triage':
			return 'triage';
		default:
			return 'unstarted';
	}
}

/** True when an issue sits in a bucket that ends its life: done or canceled. */
export function isLinearIssueClosed(
	issue: Pick<LinearIssueWire, 'stateType'>,
): boolean {
	return CLOSED_BUCKETS.includes(resolveLinearStateBucket(issue));
}

/**
 * Sort rank for a Linear priority number, which counts *up* as urgency falls
 * and reserves 0 for "none" — so the raw number sorts backwards.
 * @param priority - Linear priority number, 0 (none) through 4 (low)
 * @returns A rank that sorts urgent first and unprioritized last
 */
export function linearPriorityRank(priority: number | null): number {
	return priority === null || priority === 0 ? 5 : priority;
}

/** Localized name of a normalized workflow-state bucket. */
export function getLinearStateBucketLabel(bucket: LinearStateBucket): string {
	switch (bucket) {
		case 'triage':
			return i18n.t('linear:state-bucket.triage', 'Triage');
		case 'started':
			return i18n.t('linear:state-bucket.started', 'In progress');
		case 'unstarted':
			return i18n.t('linear:state-bucket.unstarted', 'Todo');
		case 'backlog':
			return i18n.t('linear:state-bucket.backlog', 'Backlog');
		case 'completed':
			return i18n.t('linear:state-bucket.completed', 'Done');
		default:
			return i18n.t('linear:state-bucket.canceled', 'Canceled');
	}
}

/**
 * Filters, groups, and sorts the browse list in one pass, so the toolbar's three
 * controls resolve to a single render-ready shape instead of three chained
 * transforms in the component.
 * @param options - The cached issues plus the toolbar's scope, grouping, and sort
 * @returns The grouped sections and the number of issues that survived the scope
 */
export function orderLinearIssues({
	grouping,
	issues,
	scope,
	sort,
}: {
	grouping: LinearIssueGrouping;
	issues: readonly LinearIssueWire[];
	scope: LinearIssueScope;
	sort: LinearIssueSort;
}): LinearIssueBoard {
	const scoped = issues.filter((issue) => matchesScope(issue, scope));
	const sorted = [...scoped].sort(compareBy(sort));

	return {
		groups: groupIssues(sorted, grouping),
		total: scoped.length,
	};
}

/** True when an issue belongs in the selected completion scope. */
function matchesScope(
	issue: LinearIssueWire,
	scope: LinearIssueScope,
): boolean {
	if (scope === 'all') {
		return true;
	}

	return isLinearIssueClosed(issue) === (scope === 'closed');
}

/**
 * Builds the comparator for one sort mode. Every mode falls through to the same
 * tiebreakers so two runs over the same data never reorder rows.
 * @param sort - The selected sort mode
 * @returns A comparator over issues
 */
function compareBy(
	sort: LinearIssueSort,
): (left: LinearIssueWire, right: LinearIssueWire) => number {
	return (left, right) => {
		const primary = comparePrimary(left, right, sort);

		if (primary !== 0) {
			return primary;
		}

		return (
			linearPriorityRank(left.priority) - linearPriorityRank(right.priority) ||
			compareUpdated(left, right) ||
			left.identifier.localeCompare(right.identifier)
		);
	};
}

/** Applies the field the selected sort mode leads with. */
function comparePrimary(
	left: LinearIssueWire,
	right: LinearIssueWire,
	sort: LinearIssueSort,
): number {
	switch (sort) {
		case 'priority':
			return (
				linearPriorityRank(left.priority) - linearPriorityRank(right.priority)
			);
		case 'status':
			return (
				STATE_BUCKET_ORDER.indexOf(resolveLinearStateBucket(left)) -
				STATE_BUCKET_ORDER.indexOf(resolveLinearStateBucket(right))
			);
		case 'title':
			return left.title.localeCompare(right.title);
		default:
			return compareUpdated(left, right);
	}
}

/** Orders by last update, newest first, with never-updated issues last. */
function compareUpdated(left: LinearIssueWire, right: LinearIssueWire): number {
	return updatedAtMs(right) - updatedAtMs(left);
}

/** Parses an issue's `updatedAt` into a comparable number. */
function updatedAtMs(issue: LinearIssueWire): number {
	if (!issue.updatedAt) {
		return Number.NEGATIVE_INFINITY;
	}

	const parsed = Date.parse(issue.updatedAt);

	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** Buckets already-sorted issues into the sections the list renders. */
function groupIssues(
	issues: readonly LinearIssueWire[],
	grouping: LinearIssueGrouping,
): LinearIssueGroup[] {
	switch (grouping) {
		case 'status':
			return groupByStatus(issues);
		case 'priority':
			return groupByPriority(issues);
		case 'assignee':
			return groupByAssignee(issues);
		default:
			return issues.length === 0
				? []
				: [
						{
							id: 'all',
							issues: [...issues],
							label: null,
							priority: null,
							stateBucket: null,
						},
					];
	}
}

/** One section per normalized state bucket, in tracker order, empties dropped. */
function groupByStatus(issues: readonly LinearIssueWire[]): LinearIssueGroup[] {
	const byBucket = bucketIssues(issues, resolveLinearStateBucket);

	const groups: LinearIssueGroup[] = [];

	for (const bucket of STATE_BUCKET_ORDER) {
		const bucketIssueList = byBucket.get(bucket);

		if (bucketIssueList) {
			groups.push({
				id: bucket,
				issues: bucketIssueList,
				label: getLinearStateBucketLabel(bucket),
				priority: null,
				stateBucket: bucket,
			});
		}
	}

	return groups;
}

/** One section per priority level, urgent first and unprioritized last. */
function groupByPriority(
	issues: readonly LinearIssueWire[],
): LinearIssueGroup[] {
	const byRank = bucketIssues(issues, (issue) =>
		linearPriorityRank(issue.priority),
	);

	const groups: LinearIssueGroup[] = [];

	for (const priority of LINEAR_PRIORITY_ORDER) {
		const rankedIssues = byRank.get(linearPriorityRank(priority));

		if (rankedIssues) {
			groups.push({
				id: `priority-${priority}`,
				issues: rankedIssues,
				label: getLinearPriorityLabel(priority),
				priority,
				stateBucket: null,
			});
		}
	}

	return groups;
}

/**
 * Buckets issues by a derived key in one pass, so a grouping walks the list once
 * rather than once per section.
 * @param issues - The issues to bucket
 * @param keyOf - Derives the section key an issue belongs to
 * @returns Each key mapped to its issues, in encounter order
 */
function bucketIssues<TKey>(
	issues: readonly LinearIssueWire[],
	keyOf: (issue: LinearIssueWire) => TKey,
): Map<TKey, LinearIssueWire[]> {
	const buckets = new Map<TKey, LinearIssueWire[]>();

	for (const issue of issues) {
		const key = keyOf(issue);
		const existing = buckets.get(key);

		if (existing) {
			existing.push(issue);
			continue;
		}

		buckets.set(key, [issue]);
	}

	return buckets;
}

/** One section per assignee, alphabetical, with unassigned work last. */
function groupByAssignee(
	issues: readonly LinearIssueWire[],
): LinearIssueGroup[] {
	const groups = new Map<string, LinearIssueGroup>();

	for (const issue of issues) {
		const id = issue.assigneeId ?? UNASSIGNED_GROUP_ID;
		const existing = groups.get(id);

		if (existing) {
			existing.issues.push(issue);
			continue;
		}

		groups.set(id, {
			id,
			issues: [issue],
			label:
				issue.assigneeName ??
				i18n.t('linear:issue-list.unassigned', 'Unassigned'),
			priority: null,
			stateBucket: null,
		});
	}

	return [...groups.values()].sort(compareAssigneeGroups);
}

/** Sorts assignee sections alphabetically, pinning unassigned work to the end. */
function compareAssigneeGroups(
	left: LinearIssueGroup,
	right: LinearIssueGroup,
): number {
	if (left.id === UNASSIGNED_GROUP_ID || right.id === UNASSIGNED_GROUP_ID) {
		return left.id === UNASSIGNED_GROUP_ID ? 1 : -1;
	}

	return (left.label ?? '').localeCompare(right.label ?? '');
}
