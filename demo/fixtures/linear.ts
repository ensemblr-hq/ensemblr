import type {
	LinearIssueWire,
	LinearMetadataWire,
	LinearResourceWire,
} from '@/shared/ipc/contracts/linear';

import { DEMO_CLOCK } from './workspaces.ts';

const ACCOUNT_ID = 'demo-linear-account';
const ORGANIZATION = 'Northwind';
const TEAM_ID = 'team-eng';

/**
 * Builds a metadata resource row.
 * @param kind - Which table the row belongs to.
 * @param id - Resource id.
 * @param name - Display name.
 * @param extra - Colour, key, or workflow type where the kind carries one.
 * @returns The resource row the pickers render.
 */
function resource(
	kind: LinearResourceWire['kind'],
	id: string,
	name: string,
	extra: Partial<LinearResourceWire> = {},
): LinearResourceWire {
	return {
		accountId: ACCOUNT_ID,
		color: null,
		id,
		key: null,
		kind,
		name,
		organizationName: ORGANIZATION,
		teamId: kind === 'team' ? null : TEAM_ID,
		type: null,
		...extra,
	};
}

/** Teams, states, labels and people the Linear views and pickers read. */
export const DEMO_LINEAR_METADATA: LinearMetadataWire = {
	cycles: [resource('cycle', 'cycle-24', 'Cycle 24', { key: '24' })],
	labels: [
		resource('label', 'label-bug', 'Bug', { color: '#eb5757' }),
		resource('label', 'label-perf', 'Performance', { color: '#f2c94c' }),
		resource('label', 'label-ux', 'UX', { color: '#5e6ad2' }),
	],
	projects: [
		resource('project', 'project-desktop', 'Desktop 1.0'),
		resource('project', 'project-api', 'Public API'),
	],
	states: [
		resource('state', 'state-backlog', 'Backlog', { type: 'backlog' }),
		resource('state', 'state-todo', 'Todo', { type: 'unstarted' }),
		resource('state', 'state-progress', 'In Progress', { type: 'started' }),
		resource('state', 'state-review', 'In Review', { type: 'started' }),
		resource('state', 'state-done', 'Done', { type: 'completed' }),
	],
	syncedAt: DEMO_CLOCK,
	teams: [resource('team', TEAM_ID, 'Engineering', { key: 'ENG' })],
	users: [
		resource('user', 'user-you', 'Philipp'),
		resource('user', 'user-mara', 'Mara Ellis'),
		resource('user', 'user-dev', 'Devon Park'),
	],
};

/**
 * Builds one issue row.
 * @param options - The fields that differ between issues.
 * @returns The issue as the Linear list and detail views read it.
 */
function issue(options: {
	assigneeName: string | null;
	description?: string;
	identifier: string;
	labels?: readonly { color: string; name: string }[];
	priority: number;
	stateColor: string;
	stateName: string;
	stateType: string;
	title: string;
}): LinearIssueWire {
	return {
		accountId: ACCOUNT_ID,
		archivedAt: null,
		assigneeId: options.assigneeName ? 'user-you' : null,
		assigneeName: options.assigneeName,
		cycleId: 'cycle-24',
		cycleName: 'Cycle 24',
		description: options.description ?? null,
		dueDate: null,
		id: `issue-${options.identifier.toLowerCase()}`,
		identifier: options.identifier,
		labels: (options.labels ?? []).map((label) => ({
			color: label.color,
			id: `label-${label.name.toLowerCase()}`,
			name: label.name,
		})),
		organizationName: ORGANIZATION,
		priority: options.priority,
		projectId: 'project-desktop',
		projectName: 'Desktop 1.0',
		stateColor: options.stateColor,
		stateId: `state-${options.stateType}`,
		stateName: options.stateName,
		stateType: options.stateType,
		syncedAt: DEMO_CLOCK,
		teamId: TEAM_ID,
		teamKey: 'ENG',
		teamName: 'Engineering',
		title: options.title,
		updatedAt: DEMO_CLOCK,
		url: `https://linear.app/${ORGANIZATION.toLowerCase()}/issue/${options.identifier}`,
	};
}

/**
 * The issue list the Linear views and the board's Backlog column render.
 * Fourteen issues across the five workflow states, because the view groups by
 * state and a group of one reads as an empty product rather than a quiet week.
 */
export const DEMO_LINEAR_ISSUES: readonly LinearIssueWire[] = [
	issue({
		assigneeName: 'Philipp',
		description:
			'The updates panel shows a version and a link but never the release notes. The feed already carries a `body` for every release — wire it through `resolveUpdate` and render it under the version.',
		identifier: 'ENG-412',
		labels: [{ color: '#5e6ad2', name: 'UX' }],
		priority: 2,
		stateColor: '#f2c94c',
		stateName: 'In Progress',
		stateType: 'started',
		title: 'Show release notes in the updates panel',
	}),
	issue({
		assigneeName: 'Mara Ellis',
		identifier: 'ENG-408',
		labels: [{ color: '#eb5757', name: 'Bug' }],
		priority: 1,
		stateColor: '#f2c94c',
		stateName: 'In Review',
		stateType: 'started',
		title: 'Tray icon renders at the wrong density on Linux',
	}),
	issue({
		assigneeName: null,
		identifier: 'ENG-415',
		labels: [{ color: '#f2c94c', name: 'Performance' }],
		priority: 3,
		stateColor: '#bec2c8',
		stateName: 'Backlog',
		stateType: 'backlog',
		title: 'Virtualize the diff viewer for files over 4k lines',
	}),
	issue({
		assigneeName: null,
		identifier: 'ENG-419',
		priority: 2,
		stateColor: '#bec2c8',
		stateName: 'Backlog',
		stateType: 'backlog',
		title: 'Retry webhook dispatch with exponential backoff',
	}),
	issue({
		assigneeName: 'Devon Park',
		identifier: 'ENG-401',
		priority: 0,
		stateColor: '#bec2c8',
		stateName: 'Todo',
		stateType: 'unstarted',
		title: 'Composer: attachment chips wrap mid-word on narrow panels',
	}),
	issue({
		assigneeName: 'Philipp',
		identifier: 'ENG-421',
		labels: [{ color: '#f2c94c', name: 'Performance' }],
		priority: 1,
		stateColor: '#f2c94c',
		stateName: 'In Progress',
		stateType: 'started',
		title: 'Terminal repaints the whole viewport on every streamed line',
	}),
	issue({
		assigneeName: 'Mara Ellis',
		identifier: 'ENG-424',
		priority: 2,
		stateColor: '#f2c94c',
		stateName: 'In Progress',
		stateType: 'started',
		title: 'Cursor pagination for the list endpoints',
	}),
	issue({
		assigneeName: 'Devon Park',
		identifier: 'ENG-417',
		labels: [{ color: '#eb5757', name: 'Bug' }],
		priority: 1,
		stateColor: '#f2c94c',
		stateName: 'In Review',
		stateType: 'started',
		title: 'Idempotency keys are dropped on retried writes',
	}),
	issue({
		assigneeName: 'Philipp',
		identifier: 'ENG-410',
		labels: [{ color: '#5e6ad2', name: 'UX' }],
		priority: 2,
		stateColor: '#5e6ad2',
		stateName: 'Done',
		stateType: 'completed',
		title: 'Quit confirmation when agents are still running',
	}),
	issue({
		assigneeName: 'Mara Ellis',
		identifier: 'ENG-405',
		priority: 3,
		stateColor: '#5e6ad2',
		stateName: 'Done',
		stateType: 'completed',
		title: 'Secret storage falls back to plaintext with no keyring',
	}),
	issue({
		assigneeName: null,
		identifier: 'ENG-426',
		priority: 3,
		stateColor: '#bec2c8',
		stateName: 'Backlog',
		stateType: 'backlog',
		title: 'Audit log for admin actions',
	}),
	issue({
		assigneeName: null,
		identifier: 'ENG-428',
		labels: [{ color: '#5e6ad2', name: 'UX' }],
		priority: 0,
		stateColor: '#bec2c8',
		stateName: 'Backlog',
		stateType: 'backlog',
		title: 'Let a workspace be renamed from the board card',
	}),
	issue({
		assigneeName: 'Devon Park',
		identifier: 'ENG-407',
		priority: 2,
		stateColor: '#bec2c8',
		stateName: 'Todo',
		stateType: 'unstarted',
		title: 'Native menu accelerators steal the composer chord',
	}),
	issue({
		assigneeName: null,
		identifier: 'ENG-430',
		labels: [{ color: '#eb5757', name: 'Bug' }],
		priority: 1,
		stateColor: '#bec2c8',
		stateName: 'Todo',
		stateType: 'unstarted',
		title: 'Rate limit headers report the wrong window on burst',
	}),
];
