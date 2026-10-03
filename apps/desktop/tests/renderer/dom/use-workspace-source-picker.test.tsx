// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test } from 'vitest';
import { linearIssuesQuery } from '@/renderer/api/ensemblr';
import { useWorkspaceSourcePicker } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-source-picker';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type {
	LinearIssueWire,
	ListLinearIssuesRequest,
	ListLinearIssuesResult,
} from '@/shared/ipc/contracts/linear';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';
import type {
	ListRepositoryIssuesResult,
	RepositoryIssueWire,
} from '@/shared/ipc/contracts/workspace-sources';
import {
	LINEAR_NOT_STARTED_STATE_TYPES,
	LINEAR_STARTED_STATE_TYPES,
} from '@/shared/linear-issue-state';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from '../support/dom';

afterEach(() => {
	clearEnsemblrApi();
});

function linearIssue(over: Partial<LinearIssueWire>): LinearIssueWire {
	return {
		accountId: 'acc-1',
		archivedAt: null,
		assigneeId: null,
		assigneeName: null,
		cycleId: null,
		cycleName: null,
		description: null,
		dueDate: null,
		id: 'linear-1',
		identifier: 'ENS-1',
		labels: [],
		organizationName: 'Ensemblr',
		priority: 0,
		projectId: null,
		projectName: null,
		stateColor: null,
		stateId: 's1',
		stateName: 'Todo',
		stateType: 'unstarted',
		syncedAt: null,
		teamId: 't1',
		teamKey: 'ENS',
		teamName: 'Ensemblr',
		title: 'Untitled',
		updatedAt: null,
		url: 'https://linear.app/e/issue/ENS-1',
		...over,
	};
}

function githubIssue(over: Partial<RepositoryIssueWire>): RepositoryIssueWire {
	return {
		assigneeLogins: [],
		authorLogin: 'octocat',
		body: '',
		labels: [],
		number: 1,
		state: 'OPEN',
		title: 'Untitled',
		updatedAt: '',
		url: 'https://github.com/o/r/issues/1',
		...over,
	};
}

/** A project whose only workspace is linked to `remoteId`. */
function projectLinkedTo(remoteId: string): ProjectShellModel {
	return {
		id: 'repo-1',
		workspaces: [{ landingSummary: { linkedIssue: { remoteId } } }],
	} as unknown as ProjectShellModel;
}

/** A repository whose settings live at `/repos/copland`, with no workspaces. */
function projectAtRoot(): ProjectShellModel {
	return {
		id: 'repo-1',
		pathLabel: '/repos/copland',
		workspaces: [],
	} as unknown as ProjectShellModel;
}

/**
 * Narrows a Linear answer the way main answers a state-scoped read, so a test
 * sees which read a row came from.
 */
function scopedAnswer(
	answer: ListLinearIssuesResult,
	stateTypes: readonly string[],
): ListLinearIssuesResult {
	return {
		...answer,
		issues: answer.issues.filter(
			(issue) =>
				issue.stateType !== null && stateTypes.includes(issue.stateType),
		),
	};
}

/**
 * Installs a bridge answering every list the picker reads. A `not-started`
 * Linear read gets the Backlog and Todo rows of `linear`; a `started` read gets
 * `started`, or the started rows of `linear`; any other read gets all of
 * `linear`.
 * @returns Every Linear list request the picker made, in order
 */
function installBridge({
	githubIssues = [],
	linear,
	linearTeams,
	started,
}: {
	githubIssues?: RepositoryIssueWire[];
	linear: ListLinearIssuesResult;
	linearTeams?: string[];
	started?: ListLinearIssuesResult;
}): ListLinearIssuesRequest[] {
	const githubResult: ListRepositoryIssuesResult = {
		issues: githubIssues,
		source: 'remote',
		status: 'ok',
		syncedAt: '2026-10-03T00:00:00.000Z',
	};
	const repositorySettings: SettingsResolutionSnapshot['repository'] = {
		diagnostics: [],
		settings: linearTeams
			? [
					{
						candidates: [],
						key: 'linearTeams',
						locked: false,
						source: 'ensemblr-config',
						value: linearTeams,
					},
				]
			: [],
	};
	const linearRequests: ListLinearIssuesRequest[] = [];
	installEnsemblrApi({
		linearListIssues: async (request: ListLinearIssuesRequest) => {
			linearRequests.push(request);
			if (request.stateScope === 'not-started') {
				return scopedAnswer(linear, LINEAR_NOT_STARTED_STATE_TYPES);
			}
			if (request.stateScope === 'started') {
				return started ?? scopedAnswer(linear, LINEAR_STARTED_STATE_TYPES);
			}
			return linear;
		},
		listRepositoryBranches: async () => ({ branches: [], status: 'ok' }),
		listRepositoryIssues: async () => githubResult,
		listRepositoryPullRequests: async () => ({
			pullRequests: [],
			status: 'ok',
		}),
		resolveSettings: async (): Promise<SettingsResolutionSnapshot> => ({
			app: { diagnostics: [], settings: [] },
			repository: repositorySettings,
		}),
	});
	return linearRequests;
}

/** Renders the picker hook on the Issues tab of `repo-1`, searched for `query`. */
function renderIssuesTab(projects: ProjectShellModel[], query = '') {
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const rendered = renderHook(
		({ search }: { search: string }) =>
			useWorkspaceSourcePicker({
				kind: 'issue',
				open: true,
				projects,
				query: search,
				repoId: 'repo-1',
			}),
		{ initialProps: { search: query }, wrapper },
	);
	return { ...rendered, client };
}

/** A Linear answer holding one issue per state the started search must sort out. */
const MIXED_STATE_LINEAR: ListLinearIssuesResult = {
	accountFailures: [],
	issues: [
		linearIssue({ id: 'todo', title: 'Todo issue' }),
		linearIssue({
			id: 'in-progress',
			stateType: 'started',
			title: 'In progress issue',
		}),
		linearIssue({
			id: 'linked-started',
			stateType: 'started',
			title: 'Linked started issue',
		}),
		linearIssue({ id: 'done', stateType: 'completed', title: 'Done issue' }),
	],
	source: 'remote',
	status: 'ok',
};

test('the Issues tab drops started and already-linked issues from live query data', async () => {
	const linearRequests = installBridge({
		githubIssues: [
			githubIssue({ number: 1, title: 'Linked GitHub issue' }),
			githubIssue({
				number: 2,
				title: 'Free GitHub issue',
				url: 'https://github.com/o/r/issues/2',
			}),
		],
		linear: {
			accountFailures: [],
			issues: [
				linearIssue({ id: 'todo', title: 'Todo issue' }),
				linearIssue({
					id: 'started',
					stateType: 'started',
					title: 'Started issue',
				}),
			],
			source: 'remote',
			status: 'ok',
		},
	});

	const { result } = renderIssuesTab([
		projectLinkedTo('https://github.com/o/r/issues/1'),
	]);

	await waitFor(() => expect(result.current.sources).toHaveLength(2));
	expect(result.current.sources.map((source) => source.title)).toEqual([
		'Free GitHub issue',
		'Todo issue',
	]);
	expect(result.current.itemsById.has('started')).toBe(false);
	expect(result.current.startedSources).toEqual([]);
	expect(
		linearRequests.every((request) => request.stateScope === 'not-started'),
	).toBe(true);
});

// The not-started read holds no started issue, so they come from the started read.
test('a search on the Issues tab also reaches unlinked Linear issues in progress', async () => {
	const linearRequests = installBridge({ linear: MIXED_STATE_LINEAR });

	const { result } = renderIssuesTab(
		[projectLinkedTo('linked-started')],
		'issue',
	);

	await waitFor(() => expect(result.current.startedSources).toHaveLength(1));
	expect(result.current.startedSources[0]?.title).toBe('In progress issue');
	expect(result.current.sources.map((source) => source.title)).toEqual([
		'Todo issue',
	]);
	expect(result.current.itemsById.get('in-progress')).toMatchObject({
		kind: 'linear-issue',
	});
	expect(result.current.itemsById.has('linked-started')).toBe(false);
	expect(result.current.itemsById.has('done')).toBe(false);
	expect(
		linearRequests.some((request) => request.stateScope === 'started'),
	).toBe(true);
});

test('the picker asks for the started scope only while the Issues tab is searched', async () => {
	const linearRequests = installBridge({ linear: MIXED_STATE_LINEAR });

	const { rerender, result } = renderIssuesTab([]);
	await waitFor(() => expect(result.current.sources).toHaveLength(1));
	expect(linearRequests.map((request) => request.stateScope)).toEqual([
		'not-started',
	]);

	rerender({ search: 'issue' });

	await waitFor(() => expect(result.current.startedSources).toHaveLength(2));
	expect(linearRequests.map((request) => request.stateScope)).toEqual([
		'not-started',
		'started',
	]);
});

test('a search names the Linear gap when the started issues could not be read', async () => {
	installBridge({
		started: {
			accountFailures: [],
			failure: {
				code: 'reconnect-required',
				message: 'expired',
				retryAfterSeconds: null,
			},
			issues: [],
			status: 'error',
		},
		linear: MIXED_STATE_LINEAR,
	});

	const { rerender, result } = renderIssuesTab([]);
	await waitFor(() => expect(result.current.sources).toHaveLength(1));
	expect(result.current.linearGap).toBeNull();

	rerender({ search: 'issue' });

	await waitFor(() =>
		expect(result.current.linearGap).toMatch(/Reconnect from integration/),
	);
	expect(result.current.startedSources).toEqual([]);
});

test('clearing the search drops the started issues again', async () => {
	installBridge({ linear: MIXED_STATE_LINEAR });

	const { rerender, result } = renderIssuesTab([], 'issue');
	await waitFor(() => expect(result.current.startedSources).toHaveLength(2));

	rerender({ search: '   ' });

	expect(result.current.startedSources).toEqual([]);
	expect(result.current.itemsById.has('in-progress')).toBe(false);
	expect(result.current.sources.map((source) => source.title)).toEqual([
		'Todo issue',
	]);
});

test('the Issues tab orders rows by priority, then by last update, across providers', async () => {
	installBridge({
		githubIssues: [
			githubIssue({
				number: 2,
				title: 'Fresh GitHub issue',
				updatedAt: '2026-10-02T00:00:00.000Z',
				url: 'https://github.com/o/r/issues/2',
			}),
		],
		linear: {
			accountFailures: [],
			issues: [
				linearIssue({
					id: 'stale-backlog',
					priority: 0,
					stateType: 'backlog',
					title: 'Stale backlog issue',
					updatedAt: '2026-09-01T00:00:00.000Z',
				}),
				linearIssue({
					id: 'urgent-todo',
					priority: 1,
					title: 'Urgent todo issue',
					updatedAt: '2026-08-01T00:00:00.000Z',
				}),
			],
			source: 'remote',
			status: 'ok',
		},
	});

	const { result } = renderIssuesTab([]);

	await waitFor(() => expect(result.current.sources).toHaveLength(3));
	expect(result.current.sources.map((source) => source.title)).toEqual([
		'Urgent todo issue',
		'Fresh GitHub issue',
		'Stale backlog issue',
	]);
});

test('the Issues tab keeps only the Linear teams the repository names', async () => {
	installBridge({
		linear: {
			accountFailures: [],
			issues: [
				linearIssue({ id: 'ens', teamKey: 'ENS', title: 'Ensemblr issue' }),
				linearIssue({
					id: 'mkt',
					teamId: 't-mkt',
					teamKey: 'MKT',
					title: 'Marketing issue',
				}),
			],
			source: 'remote',
			status: 'ok',
		},
		linearTeams: ['ens'],
	});

	const { result } = renderIssuesTab([projectAtRoot()]);

	await waitFor(() => expect(result.current.isLoading).toBe(false));
	expect(result.current.sources.map((source) => source.title)).toEqual([
		'Ensemblr issue',
	]);
	expect(result.current.itemsById.has('mkt')).toBe(false);
});

test('the Issues tab keeps every Linear team when the repository names none', async () => {
	installBridge({
		linear: {
			accountFailures: [],
			issues: [
				linearIssue({ id: 'ens', teamKey: 'ENS', title: 'Ensemblr issue' }),
				linearIssue({ id: 'mkt', teamKey: 'MKT', title: 'Marketing issue' }),
			],
			source: 'remote',
			status: 'ok',
		},
	});

	const { result } = renderIssuesTab([projectAtRoot()]);

	await waitFor(() => expect(result.current.sources).toHaveLength(2));
	expect(result.current.isLoading).toBe(false);
});

test('a search reaches started issues only in the teams the repository names', async () => {
	installBridge({
		linear: {
			accountFailures: [],
			issues: [
				linearIssue({
					id: 'ens-started',
					stateType: 'started',
					teamKey: 'ENS',
					title: 'Ensemblr started issue',
				}),
				linearIssue({
					id: 'mkt-started',
					stateType: 'started',
					teamId: 't-mkt',
					teamKey: 'MKT',
					title: 'Marketing started issue',
				}),
			],
			source: 'remote',
			status: 'ok',
		},
		linearTeams: ['ens'],
	});

	const { result } = renderIssuesTab([projectAtRoot()], 'issue');

	await waitFor(() => expect(result.current.startedSources).toHaveLength(1));
	expect(result.current.startedSources[0]?.title).toBe(
		'Ensemblr started issue',
	);
	expect(result.current.itemsById.has('mkt-started')).toBe(false);
});

// Stale cached rows the filter empties out say nothing about what the running
// refresh will bring, so "nothing to start" would be premature.
test('an emptied Issues tab reads as loading while a Linear refresh runs', async () => {
	installBridge({
		linear: {
			accountFailures: [],
			issues: [linearIssue({ stateType: 'started' })],
			source: 'cache',
			status: 'ok',
			syncing: true,
		},
	});

	const { client, result } = renderIssuesTab([]);

	await waitFor(() =>
		expect(
			client.getQueryData(
				linearIssuesQuery({ stateScope: 'not-started' }).queryKey,
			),
		).toBeDefined(),
	);
	expect(result.current.isLoading).toBe(true);
	expect(result.current.sources).toEqual([]);
});

test('the Issues tab reports why Linear rows are missing when the read failed', async () => {
	installBridge({
		linear: {
			accountFailures: [],
			failure: {
				code: 'reconnect-required',
				message: 'expired',
				retryAfterSeconds: null,
			},
			issues: [],
			status: 'error',
		},
	});

	const { result } = renderIssuesTab([]);

	await waitFor(() =>
		expect(result.current.linearGap).toMatch(/Reconnect from integration/),
	);
	expect(result.current.isLoading).toBe(false);
});

// A user who never linked Linear simply has no Linear issues.
test('a disconnected Linear is not reported as a gap', async () => {
	installBridge({
		linear: {
			accountFailures: [],
			failure: {
				code: 'not-connected',
				message: 'none',
				retryAfterSeconds: null,
			},
			issues: [],
			status: 'error',
		},
	});

	const { result } = renderIssuesTab([]);

	await waitFor(() => expect(result.current.isLoading).toBe(false));
	expect(result.current.linearGap).toBeNull();
});
