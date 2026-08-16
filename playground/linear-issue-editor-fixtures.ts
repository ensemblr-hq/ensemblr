import type {
	GetLinearMetadataResult,
	LinearAccountSnapshot,
	LinearIssueWire,
	LinearMetadataWire,
	LinearResourceWire,
} from '@/shared/ipc/contracts/linear';

/** The two connected accounts the browse toolbar's organization filter lists. */
export const FIXTURE_LINEAR_ACCOUNTS: readonly LinearAccountSnapshot[] = [
	{
		expiresAt: null,
		id: 'account-1',
		lastErrorCode: null,
		organizationId: 'org-1',
		organizationName: 'Ensemblr',
		organizationUrlKey: 'ensemblr',
		scopes: ['read', 'write'],
		state: 'connected',
		updatedAt: '2026-08-16T09:00:00.000Z',
		userEmail: 'philipp@theswisscheese.com',
		userId: 'user-1',
		userName: 'Philipp Soldunov',
	},
	{
		expiresAt: null,
		id: 'account-2',
		lastErrorCode: null,
		organizationId: 'org-2',
		organizationName: 'Theswisscheese',
		organizationUrlKey: 'theswisscheese',
		scopes: ['read', 'write'],
		state: 'connected',
		updatedAt: '2026-08-16T09:00:00.000Z',
		userEmail: 'philipp@theswisscheese.com',
		userId: 'user-1',
		userName: 'Philipp Soldunov',
	},
];

/**
 * Build one metadata row, defaulting the fields a given kind does not carry so
 * each fixture below states only what distinguishes it.
 * @param resource - The fields this row actually sets
 * @returns A complete wire resource
 */
function resource(
	resource: Partial<LinearResourceWire> &
		Pick<LinearResourceWire, 'id' | 'kind' | 'name'>,
): LinearResourceWire {
	return {
		accountId: 'account-1',
		color: null,
		key: null,
		organizationName: 'Ensemblr',
		teamId: null,
		type: null,
		...resource,
	};
}

/**
 * Picker metadata spanning two organizations, because the editor's hardest
 * layout case is the one where a team name alone is ambiguous. Cycle `cycle-2`
 * is deliberately unnamed — Linear leaves `name` empty there, and the picker
 * has to fall back to the number in `key`.
 */
const METADATA: LinearMetadataWire = {
	cycles: [
		resource({
			id: 'cycle-1',
			key: '41',
			kind: 'cycle',
			name: 'Hardening',
			teamId: 'team-1',
		}),
		resource({
			id: 'cycle-2',
			key: '42',
			kind: 'cycle',
			name: '',
			teamId: 'team-1',
		}),
	],
	labels: [
		resource({
			color: '#e5484d',
			id: 'label-1',
			kind: 'label',
			name: 'Bug',
			teamId: 'team-1',
		}),
		resource({
			color: '#3e63dd',
			id: 'label-2',
			kind: 'label',
			name: 'Feature',
			teamId: 'team-1',
		}),
		resource({
			color: '#30a46c',
			id: 'label-3',
			kind: 'label',
			name: 'Improvement',
			teamId: 'team-1',
		}),
		resource({
			color: '#f5a524',
			id: 'label-4',
			kind: 'label',
			name: 'Design',
			teamId: 'team-1',
		}),
		resource({
			color: '#8e4ec6',
			id: 'label-5',
			kind: 'label',
			name: 'Needs discussion',
			teamId: 'team-1',
		}),
	],
	projects: [
		resource({
			id: 'project-1',
			kind: 'project',
			name: 'Multi-account Linear',
		}),
		resource({ id: 'project-2', kind: 'project', name: 'Agent control' }),
	],
	states: [
		resource({
			color: '#bec2c8',
			id: 'state-1',
			kind: 'state',
			name: 'Backlog',
			teamId: 'team-1',
			type: 'backlog',
		}),
		resource({
			color: '#e2e2e2',
			id: 'state-2',
			kind: 'state',
			name: 'Todo',
			teamId: 'team-1',
			type: 'unstarted',
		}),
		resource({
			color: '#f2c94c',
			id: 'state-3',
			kind: 'state',
			name: 'In Progress',
			teamId: 'team-1',
			type: 'started',
		}),
		resource({
			color: '#5e6ad2',
			id: 'state-4',
			kind: 'state',
			name: 'In Review',
			teamId: 'team-1',
			type: 'started',
		}),
		resource({
			color: '#30a46c',
			id: 'state-5',
			kind: 'state',
			name: 'Done',
			teamId: 'team-1',
			type: 'completed',
		}),
	],
	syncedAt: '2026-08-16T09:00:00.000Z',
	teams: [
		resource({ id: 'team-1', key: 'ENS', kind: 'team', name: 'Engineering' }),
		resource({ id: 'team-2', key: 'DES', kind: 'team', name: 'Design' }),
		resource({
			accountId: 'account-2',
			id: 'team-3',
			key: 'ENG',
			kind: 'team',
			name: 'Engineering',
			organizationName: 'Theswisscheese',
		}),
	],
	users: [
		resource({ id: 'user-1', kind: 'user', name: 'Philipp Soldunov' }),
		resource({ id: 'user-2', kind: 'user', name: 'Ada Lovelace' }),
	],
};

/**
 * Answer the editor's metadata query without Electron.
 * @returns The cached-metadata result the dialog's pickers read
 */
export function resolveFixtureLinearMetadata(): GetLinearMetadataResult {
	return { accountFailures: [], metadata: METADATA, status: 'ok' };
}

/**
 * An issue to open the editor's edit mode against, with a team, a state, two
 * labels, and a due date already set.
 * @returns The issue the edit scene loads
 */
export function createFixtureLinearIssue(): LinearIssueWire {
	return {
		accountId: 'account-1',
		archivedAt: null,
		assigneeId: 'user-1',
		assigneeName: 'Philipp Soldunov',
		cycleId: 'cycle-1',
		cycleName: 'Hardening',
		description:
			'The picker grid reads as one undifferentiated block of controls.\n\nGive the title its own weight, and move the optional fields into a meta row.',
		dueDate: '2026-08-28',
		id: 'issue-1',
		identifier: 'ENS-214',
		labels: [
			{ color: '#e5484d', id: 'label-1', name: 'Bug' },
			{ color: '#f5a524', id: 'label-4', name: 'Design' },
		],
		organizationName: 'Ensemblr',
		priority: 2,
		projectId: 'project-1',
		projectName: 'Multi-account Linear',
		stateColor: '#5e6ad2',
		stateId: 'state-4',
		stateName: 'In Review',
		stateType: 'started',
		syncedAt: '2026-08-16T09:00:00.000Z',
		teamId: 'team-1',
		teamKey: 'ENS',
		teamName: 'Engineering',
		title: 'Overhaul the Linear issue editor',
		updatedAt: '2026-08-16T08:30:00.000Z',
		url: 'https://linear.app/ensemblr/issue/ENS-214',
	};
}
