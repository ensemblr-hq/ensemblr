import type {
	LinearAccountSnapshot,
	LinearConnectionSummary,
	LinearIssueWire,
	LinearServiceFailure,
} from '@/shared/ipc';

/** Builds a Linear issue wire fixture with sensible defaults. */
export function createLinearIssueFixture(
	overrides: Partial<LinearIssueWire> = {},
): LinearIssueWire {
	return {
		accountId: 'account-1',
		archivedAt: null,
		assigneeId: 'user-1',
		assigneeName: 'Alice',
		cycleId: 'cycle-1',
		cycleName: 'Cycle 12',
		description: 'Implement OAuth PKCE login against the Linear API.',
		dueDate: null,
		id: 'issue-1',
		identifier: 'ENG-143',
		labels: [{ color: '#eb5757', id: 'label-1', name: 'bug' }],
		organizationName: 'Example Org',
		priority: 2,
		projectId: 'project-1',
		projectName: 'Ensemblr',
		stateColor: '#e2e2e2',
		stateId: 'state-1',
		stateName: 'Todo',
		stateType: 'unstarted',
		syncedAt: '2026-06-11T00:00:00.000Z',
		teamId: 'team-1',
		teamKey: 'THE',
		teamName: 'Theseus',
		title: 'Linear OAuth PKCE and Token Lifecycle',
		updatedAt: '2026-06-10T12:00:00.000Z',
		url: 'https://linear.app/acme/issue/ENG-143',
		...overrides,
	};
}

/** Builds a single connected Linear account fixture. */
export function createLinearAccountFixture(
	overrides: Partial<LinearAccountSnapshot> = {},
): LinearAccountSnapshot {
	return {
		expiresAt: '2026-06-12T00:00:00.000Z',
		id: 'account-1',
		lastErrorCode: null,
		organizationId: 'org-1',
		organizationName: 'Example Org',
		organizationUrlKey: 'example-org',
		scopes: ['read', 'write'],
		state: 'connected',
		updatedAt: '2026-06-11T00:00:00.000Z',
		userEmail: 'alice@example.com',
		userId: 'user-1',
		userName: 'Alice',
		...overrides,
	};
}

/** Builds a Linear connection summary fixture holding one connected account. */
export function createLinearConnectionFixture(
	overrides: Partial<LinearConnectionSummary> = {},
): LinearConnectionSummary {
	return {
		accounts: [createLinearAccountFixture()],
		state: 'connected',
		...overrides,
	};
}

/** Builds a Linear service failure fixture. */
export function createLinearFailureFixture(
	overrides: Partial<LinearServiceFailure> = {},
): LinearServiceFailure {
	return {
		code: 'network',
		message: 'The Linear API is unreachable.',
		retryAfterSeconds: null,
		...overrides,
	};
}
