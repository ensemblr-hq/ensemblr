// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr';
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

test('GitHub flipping to conflicting re-probes instead of waiting for the poll', async () => {
	let paths: string[] = [];
	const getWorkspaceMergeConflicts = vi.fn(async () => ({ paths }));
	installEnsemblrApi({ getWorkspaceMergeConflicts });

	const mergeable = createWorkspace({
		landingSummary: landingSummary('master'),
		reviewFiles: [],
	});
	const { switchTo } = renderChecksPanel(mergeable);

	await waitFor(() => {
		expect(getWorkspaceMergeConflicts).toHaveBeenCalledTimes(1);
	});
	expect(screen.queryByText('Conflicts')).toBeNull();

	// The base branch moved: GitHub's snapshot poll reports it long before the
	// trial merge's own two-minute timer would run again.
	paths = ['src/renderer/styles/index.css'];
	switchTo({
		...mergeable,
		pullRequest: { ...mergeable.pullRequest, isConflicting: true },
	});

	await waitFor(() => {
		expect(
			document.querySelector(
				'[data-conflict-path="src/renderer/styles/index.css"]',
			),
		).not.toBeNull();
	});
});

test('the window after the verdict flips says the file names are still coming', async () => {
	let probeCount = 0;
	let resolveReprobe: ((value: { paths: string[] }) => void) | undefined;
	installEnsemblrApi({
		getWorkspaceMergeConflicts: vi.fn(() => {
			probeCount += 1;
			return probeCount === 1
				? Promise.resolve({ paths: [] })
				: new Promise<{ paths: string[] }>((resolve) => {
						resolveReprobe = resolve;
					});
		}),
	});

	const mergeable = createWorkspace({
		landingSummary: landingSummary('master'),
		reviewFiles: [],
	});
	const { switchTo } = renderChecksPanel(mergeable);

	await waitFor(() => {
		expect(probeCount).toBe(1);
	});
	expect(screen.queryByText('Conflicts')).toBeNull();

	switchTo({
		...mergeable,
		pullRequest: { ...mergeable.pullRequest, isConflicting: true },
	});

	// The answer on file predates the verdict now on screen, so the section
	// opens on GitHub's word rather than sitting empty until the probe lands.
	await waitFor(() => {
		expect(document.querySelector('[data-conflict-probing]')).not.toBeNull();
	});
	expect(screen.getByText('Conflicts')).toBeInTheDocument();

	resolveReprobe?.({ paths: ['src/renderer/styles/index.css'] });

	await waitFor(() => {
		expect(
			document.querySelector(
				'[data-conflict-path="src/renderer/styles/index.css"]',
			),
		).not.toBeNull();
	});
	expect(document.querySelector('[data-conflict-probing]')).toBeNull();
});

test('GitHub clearing the conflict re-probes so resolved files stop being listed', async () => {
	let paths: string[] = ['src/renderer/styles/index.css'];
	const getWorkspaceMergeConflicts = vi.fn(async () => ({ paths }));
	installEnsemblrApi({ getWorkspaceMergeConflicts });

	const conflicting = createWorkspace({
		landingSummary: landingSummary('master'),
		pullRequest: {
			...createWorkspace().pullRequest,
			isConflicting: true,
		},
		reviewFiles: [],
	});
	const { switchTo } = renderChecksPanel(conflicting);

	await waitFor(() => {
		expect(
			document.querySelector(
				'[data-conflict-path="src/renderer/styles/index.css"]',
			),
		).not.toBeNull();
	});

	paths = [];
	switchTo({
		...conflicting,
		pullRequest: { ...conflicting.pullRequest, isConflicting: false },
	});

	await waitFor(() => {
		expect(screen.queryByText('Conflicts')).toBeNull();
	});
});

test('a conflict GitHub has named but the probe has not says so instead of nothing', async () => {
	let resolveProbe: ((value: { paths: string[] }) => void) | undefined;
	const getWorkspaceMergeConflicts = vi.fn(
		() =>
			new Promise<{ paths: string[] }>((resolve) => {
				resolveProbe = resolve;
			}),
	);
	installEnsemblrApi({ getWorkspaceMergeConflicts });

	const base = createWorkspace({
		landingSummary: landingSummary('master'),
		reviewFiles: [],
	});
	renderChecksPanel({
		...base,
		pullRequest: { ...base.pullRequest, isConflicting: true },
	});

	await waitFor(() => {
		expect(document.querySelector('[data-conflict-probing]')).not.toBeNull();
	});
	expect(screen.getByText('Conflicts')).toBeInTheDocument();
	// The resolve prompt asks for a rebase rather than naming files, so it is
	// actionable before the probe answers.
	expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();

	resolveProbe?.({ paths: ['src/renderer/styles/index.css'] });

	await waitFor(() => {
		expect(
			document.querySelector(
				'[data-conflict-path="src/renderer/styles/index.css"]',
			),
		).not.toBeNull();
	});
	expect(document.querySelector('[data-conflict-probing]')).toBeNull();
});

test('coming back to a workspace whose verdict never moved does not re-probe it', async () => {
	const probed: string[] = [];
	installEnsemblrApi({
		getWorkspaceMergeConflicts: vi.fn(
			async ({ workspaceCwd }: { workspaceCwd: string }) => {
				probed.push(workspaceCwd);
				return { paths: [] };
			},
		),
	});

	const clean = createWorkspace({
		id: 'workspace-a',
		landingSummary: landingSummary('master'),
		pathLabel: '/tmp/workspace-a',
		reviewFiles: [],
	});
	const conflicting = createWorkspace({
		id: 'workspace-b',
		landingSummary: landingSummary('master'),
		pathLabel: '/tmp/workspace-b',
		pullRequest: { ...clean.pullRequest, isConflicting: true },
		reviewFiles: [],
	});

	const { switchTo } = renderChecksPanel(clean);
	await waitFor(() => {
		expect(probed).toEqual(['/tmp/workspace-a']);
	});

	switchTo(conflicting);
	await waitFor(() => {
		expect(probed).toEqual(['/tmp/workspace-a', '/tmp/workspace-b']);
	});

	// Workspace A's own verdict never moved and its answer is still inside the
	// probe's staleTime, so arriving from a differently-conflicting workspace
	// must not read as a flip and spend another `git fetch`.
	switchTo(clean);
	await waitFor(() => {
		expect(screen.getByText('Checks')).toBeInTheDocument();
	});
	await new Promise((settle) => setTimeout(settle, 50));

	expect(probed).toEqual(['/tmp/workspace-a', '/tmp/workspace-b']);
});

test('the probe’s own poll does not reopen the section it already answered', async () => {
	let probeCount = 0;
	installEnsemblrApi({
		getWorkspaceMergeConflicts: vi.fn(() => {
			probeCount += 1;
			return probeCount === 1
				? Promise.resolve({ paths: [] })
				: new Promise<{ paths: string[] }>(() => undefined);
		}),
	});

	const base = createWorkspace({
		landingSummary: landingSummary('master'),
		reviewFiles: [],
	});
	const { client } = renderChecksPanel({
		...base,
		pullRequest: { ...base.pullRequest, isConflicting: true },
	});

	// GitHub says conflicting and the trial merge disagrees, so the section
	// settles closed rather than claiming a conflict it cannot name.
	await waitFor(() => {
		expect(screen.queryByText('Conflicts')).toBeNull();
	});
	expect(probeCount).toBe(1);

	void client.refetchQueries({
		queryKey: ensemblrQueryKeys.workspaceMergeConflicts(
			'/tmp/conflicts-workspace',
			'master',
		),
	});

	await waitFor(() => {
		expect(probeCount).toBe(2);
	});
	// The verdict has not moved since that answer, so it still stands while the
	// poll runs. Reopening on every pass would flicker the section for as long
	// as the two sources disagree.
	expect(document.querySelector('[data-conflict-probing]')).toBeNull();
	expect(screen.queryByText('Conflicts')).toBeNull();
});

test('a probe running without a GitHub conflict verdict opens no section', async () => {
	installEnsemblrApi({
		getWorkspaceMergeConflicts: vi.fn(
			() => new Promise<{ paths: string[] }>(() => undefined),
		),
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
	expect(document.querySelector('[data-conflict-probing]')).toBeNull();
});
