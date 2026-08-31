// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ChecksPanel } from '../../src/renderer/components/workbench-shell/checks-panel/checks-panel';
import { ReviewActionsContextProvider } from '../../src/renderer/components/workbench-shell/review-actions/review-actions-context';
import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import type {
	PullRequestGitStatusSummary,
	ReviewActionsValue,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';
import { stubReviewActions } from './support/review-actions';

const UNCOMMITTED_GIT_STATUS: PullRequestGitStatusSummary = {
	actionLabel: 'Commit and push',
	kind: 'uncommitted',
	label: '5 uncommitted changes',
	status: 'pending',
};

const UNPUSHED_GIT_STATUS: PullRequestGitStatusSummary = {
	actionLabel: 'Push',
	kind: 'unpushed',
	label: '2 unpushed commits',
	status: 'pending',
};

const UNPUBLISHED_GIT_STATUS: PullRequestGitStatusSummary = {
	actionLabel: 'Push branch',
	kind: 'unpublished',
	label: 'Branch not pushed yet',
	status: 'pending',
};

const CLEAN_GIT_STATUS: PullRequestGitStatusSummary = {
	kind: 'clean',
	label: 'Up to date with remote',
	status: 'open',
};

function createWorkspace({
	gitStatus,
	files = 5,
	pullRequest = {},
}: {
	files?: number;
	gitStatus: PullRequestGitStatusSummary;
	pullRequest?: Partial<WorkspaceShellModel['pullRequest']>;
}): WorkspaceShellModel {
	const workspace = getDefaultWorkspace();
	return {
		...workspace,
		changeSummary: { additions: 144, deletions: 12, files },
		id: 'git-status-workspace',
		pathLabel: '/tmp/git-status-workspace',
		reviewFiles: [],
		pullRequest: {
			...workspace.pullRequest,
			checks: [],
			comments: [],
			description: [],
			gitStatus,
			todos: [],
			...pullRequest,
		},
	};
}

function renderChecksPanel(
	workspace: WorkspaceShellModel,
	reviewActions: ReviewActionsValue = stubReviewActions(),
) {
	return render(
		<Provider store={createStore()}>
			<QueryClientProvider client={createTestQueryClient()}>
				<ReviewActionsContextProvider value={reviewActions}>
					<ChecksPanel workspace={workspace} />
				</ReviewActionsContextProvider>
			</QueryClientProvider>
		</Provider>,
	);
}

beforeEach(() => {
	installEnsemblrApi({
		getWorkspaceMergeConflicts: vi.fn(async () => ({ paths: [] })),
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

test('a workspace with no PR offers Commit and push for its uncommitted changes', () => {
	const commitAndPush = vi.fn();
	renderChecksPanel(
		createWorkspace({
			gitStatus: UNCOMMITTED_GIT_STATUS,
			pullRequest: { number: undefined, status: 'idle' },
		}),
		stubReviewActions({ commitAndPush }),
	);

	expect(screen.getByText('5 uncommitted changes')).toBeInTheDocument();
	screen.getByRole('button', { name: 'Commit and push' }).click();
	expect(commitAndPush).toHaveBeenCalledTimes(1);
});

test('an open PR offers Commit and push for its uncommitted changes', () => {
	const commitAndPush = vi.fn();
	renderChecksPanel(
		createWorkspace({
			gitStatus: UNCOMMITTED_GIT_STATUS,
			pullRequest: { number: 220, state: 'open', status: 'idle' },
		}),
		stubReviewActions({ commitAndPush }),
	);

	expect(screen.getByText('5 uncommitted changes')).toBeInTheDocument();
	screen.getByRole('button', { name: 'Commit and push' }).click();
	expect(commitAndPush).toHaveBeenCalledTimes(1);
});

test('a ready-to-merge PR still offers Commit and push for uncommitted changes', () => {
	const commitAndPush = vi.fn();
	renderChecksPanel(
		createWorkspace({
			gitStatus: UNCOMMITTED_GIT_STATUS,
			pullRequest: {
				number: 220,
				state: 'open',
				status: 'ready-to-merge',
			},
		}),
		stubReviewActions({ commitAndPush }),
	);

	expect(screen.getByText('5 uncommitted changes')).toBeInTheDocument();
	screen.getByRole('button', { name: 'Commit and push' }).click();
	expect(commitAndPush).toHaveBeenCalledTimes(1);
});

test('a ready-to-merge PR still offers Push for unpushed commits', () => {
	const commitAndPush = vi.fn();
	renderChecksPanel(
		createWorkspace({
			files: 0,
			gitStatus: UNPUSHED_GIT_STATUS,
			pullRequest: {
				number: 220,
				state: 'open',
				status: 'ready-to-merge',
			},
		}),
		stubReviewActions({ commitAndPush }),
	);

	expect(screen.getByText('2 unpushed commits')).toBeInTheDocument();
	screen.getByRole('button', { name: 'Push' }).click();
	expect(commitAndPush).toHaveBeenCalledTimes(1);
});

test('a ready-to-merge PR still offers Push branch for an unpublished branch', () => {
	const commitAndPush = vi.fn();
	renderChecksPanel(
		createWorkspace({
			files: 0,
			gitStatus: UNPUBLISHED_GIT_STATUS,
			pullRequest: {
				number: 220,
				state: 'open',
				status: 'ready-to-merge',
			},
		}),
		stubReviewActions({ commitAndPush }),
	);

	expect(screen.getByText('Branch not pushed yet')).toBeInTheDocument();
	screen.getByRole('button', { name: 'Push branch' }).click();
	expect(commitAndPush).toHaveBeenCalledTimes(1);
});

test('a ready-to-merge PR with a clean worktree hides the git-status action', () => {
	renderChecksPanel(
		createWorkspace({
			files: 0,
			gitStatus: { ...CLEAN_GIT_STATUS, actionLabel: 'Merge' },
			pullRequest: {
				number: 220,
				state: 'open',
				status: 'ready-to-merge',
			},
		}),
	);

	expect(screen.getByText('Up to date with remote')).toBeInTheDocument();
	expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
});

test('a merged PR still surfaces uncommitted changes, without an Update PR action', () => {
	const commitAndPush = vi.fn();
	renderChecksPanel(
		createWorkspace({
			gitStatus: UNCOMMITTED_GIT_STATUS,
			pullRequest: { number: 220, state: 'merged', status: 'idle' },
		}),
		stubReviewActions({ commitAndPush }),
	);

	expect(screen.getByText('5 uncommitted changes')).toBeInTheDocument();
	expect(screen.queryByRole('button', { name: 'Update PR' })).toBeNull();
	screen.getByRole('button', { name: 'Commit and push' }).click();
	expect(commitAndPush).toHaveBeenCalledTimes(1);
});

test('a merged PR still surfaces unpushed commits, without an Update PR action', () => {
	const commitAndPush = vi.fn();
	renderChecksPanel(
		createWorkspace({
			files: 0,
			gitStatus: UNPUSHED_GIT_STATUS,
			pullRequest: { number: 220, state: 'merged', status: 'idle' },
		}),
		stubReviewActions({ commitAndPush }),
	);

	expect(screen.getByText('2 unpushed commits')).toBeInTheDocument();
	expect(screen.queryByRole('button', { name: 'Update PR' })).toBeNull();
	screen.getByRole('button', { name: 'Push' }).click();
	expect(commitAndPush).toHaveBeenCalledTimes(1);
});

test('a merged PR with a clean worktree renders no git-status section', () => {
	renderChecksPanel(
		createWorkspace({
			files: 0,
			gitStatus: CLEAN_GIT_STATUS,
			pullRequest: { number: 220, state: 'merged', status: 'idle' },
		}),
	);

	expect(screen.queryByText('Git status')).toBeNull();
	expect(screen.queryByText('Up to date with remote')).toBeNull();
});
