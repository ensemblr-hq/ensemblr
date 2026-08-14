// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import type {
	WorkspaceLandingSummary,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';

import { renderChecksPanel, stubReviewActions } from './support/checks-panel';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

/** A landing summary whose only load-bearing field here is the base branch. */
function landingSummary(baseBranch: string): WorkspaceLandingSummary {
	return {
		branchSource: {
			baseBranch,
			branchName: 'feature/conflicts',
			detail: `Branched from ${baseBranch}`,
		},
		copiedFiles: { count: 0, detail: 'Nothing to copy', state: 'copied' },
		headline: 'Workspace ready',
		kind: 'local-branch',
		repositoryName: 'florence',
		setupGuidance: { detail: 'No setup needed', state: 'configured' },
		workspaceName: 'conflicts',
	};
}

function createWorkspace(
	overrides: Partial<WorkspaceShellModel> = {},
): WorkspaceShellModel {
	const workspace = getDefaultWorkspace();
	return {
		...workspace,
		id: 'conflicts-test-workspace',
		pathLabel: '/tmp/conflicts-workspace',
		pullRequest: {
			...workspace.pullRequest,
			checks: [],
			comments: [],
			description: [],
			label: 'Merge conflicts',
			number: 214,
			state: 'open',
			status: 'blocked',
			todos: [],
		},
		...overrides,
	};
}

afterEach(() => {
	clearEnsemblrApi();
});

test('unmerged worktree files become the Conflicts section without a trial merge', () => {
	const getWorkspaceMergeConflicts = vi.fn();
	installEnsemblrApi({ getWorkspaceMergeConflicts });

	renderChecksPanel(
		createWorkspace({
			landingSummary: landingSummary('master'),
			reviewFiles: [
				{
					additions: 85,
					contentId: null,
					deletions: 18,
					id: 'git:src/review-file-list.tsx',
					path: 'src/review-file-list.tsx',
					status: 'conflicted',
				},
			],
		}),
	);

	expect(screen.getByText('Conflicts')).toBeInTheDocument();
	expect(
		document.querySelector('[data-conflict-path="src/review-file-list.tsx"]'),
	).not.toBeNull();
	// A worktree already mid-merge answers the question; probing it would describe
	// a state nobody is in.
	expect(getWorkspaceMergeConflicts).not.toHaveBeenCalled();
});

test('a clean worktree falls back to the trial merge for the file list', async () => {
	installEnsemblrApi({
		getWorkspaceMergeConflicts: vi.fn(async () => ({
			paths: ['src/renderer/styles/index.css'],
		})),
	});

	renderChecksPanel(
		createWorkspace({
			landingSummary: landingSummary('master'),
			reviewFiles: [],
		}),
	);

	await waitFor(() => {
		expect(
			document.querySelector(
				'[data-conflict-path="src/renderer/styles/index.css"]',
			),
		).not.toBeNull();
	});
});

test('the Resolve action hands the whole job to the agent', () => {
	const runAgentAction = vi.fn();
	installEnsemblrApi({ getWorkspaceMergeConflicts: vi.fn() });

	renderChecksPanel(
		createWorkspace({
			reviewFiles: [
				{
					additions: 1,
					contentId: null,
					deletions: 1,
					id: 'git:a.ts',
					path: 'a.ts',
					status: 'conflicted',
				},
			],
		}),
		stubReviewActions({ runAgentAction }),
	);

	screen.getByRole('button', { name: 'Resolve' }).click();
	expect(runAgentAction).toHaveBeenCalledWith('resolve-conflicts');
});

test('a branch with no conflicts renders no Conflicts section', async () => {
	installEnsemblrApi({
		getWorkspaceMergeConflicts: vi.fn(async () => ({ paths: [] })),
	});

	renderChecksPanel(
		createWorkspace({
			landingSummary: landingSummary('master'),
			reviewFiles: [],
		}),
	);

	await waitFor(() => {
		expect(screen.getByText('Checks')).toBeInTheDocument();
	});
	expect(screen.queryByText('Conflicts')).toBeNull();
});

test('a trial merge that could not run says so instead of reading as clean', async () => {
	installEnsemblrApi({
		getWorkspaceMergeConflicts: vi.fn(async () => ({
			error: {
				code: 'command-failed' as const,
				message: "fatal: 'origin' does not appear to be a git repository",
				output: "fatal: 'origin' does not appear to be a git repository",
			},
			paths: [],
		})),
	});

	renderChecksPanel(
		createWorkspace({
			landingSummary: landingSummary('master'),
			reviewFiles: [],
		}),
	);

	await waitFor(() => {
		expect(
			screen.getByText('Could not check for merge conflicts'),
		).toBeInTheDocument();
	});
	expect(screen.getByText('The command failed.')).toBeInTheDocument();
	expect(
		screen.getByText("fatal: 'origin' does not appear to be a git repository"),
	).toBeInTheDocument();
	// Nothing was learned, so there is nothing to hand the agent.
	expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
});

test('a workspace switch drops the previous workspace’s conflict paths', async () => {
	const pathsByWorkspace: Record<string, string[]> = {
		'/tmp/workspace-a': ['a-only.ts'],
	};
	installEnsemblrApi({
		getWorkspaceMergeConflicts: vi.fn(
			async ({ workspaceCwd }: { workspaceCwd: string }) => ({
				paths: pathsByWorkspace[workspaceCwd] ?? [],
			}),
		),
	});

	const { switchTo } = renderChecksPanel(
		createWorkspace({
			id: 'workspace-a',
			landingSummary: landingSummary('master'),
			pathLabel: '/tmp/workspace-a',
			reviewFiles: [],
		}),
	);

	await waitFor(() => {
		expect(
			document.querySelector('[data-conflict-path="a-only.ts"]'),
		).not.toBeNull();
	});

	// Same query cache, new key: carrying the last result across would name
	// workspace A's files under workspace B's Conflicts heading.
	switchTo(
		createWorkspace({
			id: 'workspace-b',
			landingSummary: landingSummary('master'),
			pathLabel: '/tmp/workspace-b',
			reviewFiles: [],
		}),
	);

	expect(document.querySelector('[data-conflict-path="a-only.ts"]')).toBeNull();
});
