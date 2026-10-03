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
	ListLinearIssuesResult,
} from '@/shared/ipc/contracts/linear';
import type {
	ListRepositoryIssuesResult,
	RepositoryIssueWire,
} from '@/shared/ipc/contracts/workspace-sources';
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

/** Installs a bridge answering every list the picker reads. */
function installBridge({
	githubIssues = [],
	linear,
}: {
	githubIssues?: RepositoryIssueWire[];
	linear: ListLinearIssuesResult;
}): void {
	const githubResult: ListRepositoryIssuesResult = {
		issues: githubIssues,
		source: 'remote',
		status: 'ok',
		syncedAt: '2026-10-03T00:00:00.000Z',
	};
	installEnsemblrApi({
		linearListIssues: async () => linear,
		listRepositoryBranches: async () => ({ branches: [], status: 'ok' }),
		listRepositoryIssues: async () => githubResult,
		listRepositoryPullRequests: async () => ({
			pullRequests: [],
			status: 'ok',
		}),
	});
}

/** Renders the picker hook on the Issues tab of `repo-1`. */
function renderIssuesTab(projects: ProjectShellModel[]) {
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const rendered = renderHook(
		() =>
			useWorkspaceSourcePicker({
				kind: 'issue',
				open: true,
				projects,
				repoId: 'repo-1',
			}),
		{ wrapper },
	);
	return { ...rendered, client };
}

test('the Issues tab drops started and already-linked issues from live query data', async () => {
	installBridge({
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
			client.getQueryData(linearIssuesQuery({ notStarted: true }).queryKey),
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
