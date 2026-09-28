// @vitest-environment happy-dom

import type { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr/query-keys';
import {
	getDefaultProject,
	getDefaultWorkspace,
} from '@/renderer/fixtures/workbench';
import { useLiveWorkspaceModel } from '@/renderer/hooks/workbench-shell/route-layout/use-live-workspace-model';
import type { GetWorkspaceGitStatusResult } from '@/shared/ipc/contracts/workspace-git';

const queries = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	workingTree: {
		data: undefined as GetWorkspaceGitStatusResult | undefined,
		dataUpdatedAt: 0,
	},
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tanstack/react-query')>();
	queries.client = new actual.QueryClient();
	return {
		...actual,
		useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
			queryKey.includes('workspace-git-status') &&
			queryKey.includes('working-tree')
				? queries.workingTree
				: { data: undefined, dataUpdatedAt: 0 },
		useQueryClient: () => queries.client,
	};
});
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-ensure-workspace-setup',
	() => ({
		useEnsureWorkspaceSetup: () => undefined,
	}),
);
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-workspace-files-watch',
	() => ({
		useWorkspaceFilesWatch: () => undefined,
	}),
);
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-pull-request-auto-refresh',
	() => ({
		usePullRequestAutoRefresh: () => undefined,
	}),
);
vi.mock(
	'@/renderer/hooks/workbench-shell/route-layout/use-live-pull-request-model',
	() => ({
		useLivePullRequestModel: () => null,
	}),
);

test('the open workspace carries its working-tree count into its cached branch status', () => {
	const workspace = getDefaultWorkspace();
	const branchKey = ensemblrQueryKeys.workspaceGitStatus(
		workspace.pathLabel ?? '',
		'branch:main',
	);
	const client = queries.client as QueryClient;
	client.setQueryData<GetWorkspaceGitStatusResult>(
		branchKey,
		{
			files: [{ additions: 1, deletions: 0, path: 'a.ts', status: 'modified' }],
			summary: { additions: 1, deletions: 0, files: 1 },
			uncommittedFiles: 1,
		},
		{ updatedAt: 1_000 },
	);
	queries.workingTree = {
		data: { files: [], summary: { additions: 0, deletions: 0, files: 0 } },
		dataUpdatedAt: 5_000,
	};

	renderHook(() =>
		useLiveWorkspaceModel({
			activeProject: getDefaultProject(),
			activeWorkspace: workspace,
			terminalSessions: {
				activeTerminalIds: new Set<string>(),
				closeTerminal: async () => undefined,
				createTerminal: async () => ({ diagnostics: [], session: null }),
				isLoaded: true,
				sessions: [],
			},
		}),
	);

	expect(
		client.getQueryData<GetWorkspaceGitStatusResult>(branchKey)
			?.uncommittedFiles,
	).toBe(0);
	expect(client.getQueryState(branchKey)?.dataUpdatedAt).toBe(5_000);
});
