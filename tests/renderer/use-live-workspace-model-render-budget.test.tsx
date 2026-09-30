// @vitest-environment happy-dom

/**
 * The live workspace model read `dataUpdatedAt` off the working-tree status query
 * only to carry the file count into the branch-scoped statuses. That timestamp
 * moves on every successful poll, so the whole route re-rendered every ten
 * seconds even when nothing had changed. The carry now rides a query-cache
 * subscription: an identical refetch still corrects the branch entries, and the
 * route renders only when the status data itself changes.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr/query-keys';
import {
	getDefaultProject,
	getDefaultWorkspace,
} from '@/renderer/fixtures/workbench';
import { useLiveWorkspaceModel } from '@/renderer/hooks/workbench-shell/route-layout/use-live-workspace-model';
import type { GetWorkspaceGitStatusResult } from '@/shared/ipc/contracts/workspace-git';
import { createTestQueryClient } from './support/dom';

vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-ensure-workspace-setup',
	() => ({ useEnsureWorkspaceSetup: () => undefined }),
);
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-workspace-files-watch',
	() => ({ useWorkspaceFilesWatch: () => undefined }),
);
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-pull-request-auto-refresh',
	() => ({ usePullRequestAutoRefresh: () => undefined }),
);
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-live-pull-request-model',
	() => ({ useLivePullRequestModel: () => null }),
);

const WORKSPACE = getDefaultWorkspace();
const WORKSPACE_CWD = WORKSPACE.pathLabel ?? '';
const WORKING_TREE_KEY = ensemblrQueryKeys.workspaceGitStatus(WORKSPACE_CWD);
const BRANCH_KEY = ensemblrQueryKeys.workspaceGitStatus(
	WORKSPACE_CWD,
	'branch:main',
);

/** A working-tree read with one modified file, so the status carries real data. */
function workingTreeStatus(): GetWorkspaceGitStatusResult {
	return {
		files: [{ additions: 2, deletions: 1, path: 'a.ts', status: 'modified' }],
		summary: { additions: 2, deletions: 1, files: 1 },
	};
}

/** A branch-scoped status whose cached working-tree count is `uncommittedFiles`. */
function branchStatus(uncommittedFiles: number): GetWorkspaceGitStatusResult {
	return {
		files: [{ additions: 1, deletions: 0, path: 'b.ts', status: 'modified' }],
		summary: { additions: 1, deletions: 0, files: 1 },
		uncommittedFiles,
	};
}

/** Mounts the live model over a seeded cache, counting how often the route would render. */
function renderLiveModel() {
	const client = createTestQueryClient();
	client.setQueryData(WORKING_TREE_KEY, workingTreeStatus(), {
		updatedAt: 5_000,
	});
	client.setQueryData(BRANCH_KEY, branchStatus(7), { updatedAt: 1_000 });
	const renders = { count: 0 };
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	renderHook(
		() => {
			renders.count += 1;
			return useLiveWorkspaceModel({
				activeProject: getDefaultProject(),
				activeWorkspace: WORKSPACE,
				terminalSessions: {
					activeTerminalIds: new Set<string>(),
					closeTerminal: async () => undefined,
					createTerminal: async () => ({ diagnostics: [], session: null }),
					isLoaded: true,
					sessions: [],
				},
			});
		},
		{ wrapper },
	);
	return { client, renders };
}

/** Lets a queued cache notification reach React, if one was going to. */
async function settle(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

describe('useLiveWorkspaceModel branch-status carry', () => {
	test('carries the working-tree count into a cached branch status on mount', () => {
		const { client } = renderLiveModel();

		expect(
			client.getQueryData<GetWorkspaceGitStatusResult>(BRANCH_KEY)
				?.uncommittedFiles,
		).toBe(1);
		expect(client.getQueryState(BRANCH_KEY)?.dataUpdatedAt).toBe(5_000);
	});

	test('an identical successful refetch still corrects a stale branch status', async () => {
		const { client } = renderLiveModel();
		client.setQueryData(BRANCH_KEY, branchStatus(7), { updatedAt: 6_000 });

		act(() => {
			client.setQueryData(WORKING_TREE_KEY, workingTreeStatus(), {
				updatedAt: 9_000,
			});
		});
		await settle();

		expect(
			client.getQueryData<GetWorkspaceGitStatusResult>(BRANCH_KEY)
				?.uncommittedFiles,
		).toBe(1);
		expect(client.getQueryState(BRANCH_KEY)?.dataUpdatedAt).toBe(9_000);
	});

	test('an identical successful refetch does not re-render the route', async () => {
		const { client, renders } = renderLiveModel();
		await settle();
		const rendersAfterMount = renders.count;

		act(() => {
			client.setQueryData(WORKING_TREE_KEY, workingTreeStatus(), {
				updatedAt: 9_000,
			});
		});
		await settle();

		expect(renders.count).toBe(rendersAfterMount);
	});

	test('a refetch that changes the status renders the route once', async () => {
		const { client, renders } = renderLiveModel();
		await settle();
		const rendersAfterMount = renders.count;

		act(() => {
			client.setQueryData(
				WORKING_TREE_KEY,
				{
					files: [],
					summary: { additions: 0, deletions: 0, files: 0 },
				},
				{ updatedAt: 9_000 },
			);
		});
		await settle();

		expect(renders.count).toBeGreaterThan(rendersAfterMount);
	});

	test('does not touch a branch status fetched after the working-tree read', async () => {
		const { client } = renderLiveModel();
		client.setQueryData(BRANCH_KEY, branchStatus(4), { updatedAt: 20_000 });

		act(() => {
			client.setQueryData(WORKING_TREE_KEY, workingTreeStatus(), {
				updatedAt: 9_000,
			});
		});
		await settle();

		expect(
			client.getQueryData<GetWorkspaceGitStatusResult>(BRANCH_KEY)
				?.uncommittedFiles,
		).toBe(4);
	});
});
