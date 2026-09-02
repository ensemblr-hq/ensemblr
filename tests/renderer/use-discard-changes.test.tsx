// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const { discardWorkspaceChanges } = vi.hoisted(() => ({
	discardWorkspaceChanges: vi.fn(),
}));

vi.mock('@/renderer/api/ensemblr', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/renderer/api/ensemblr')>()),
	discardWorkspaceChanges,
}));

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr';
import { useDiscardChanges } from '../../src/renderer/hooks/workbench-shell/review-files/use-discard-changes';
import type {
	ReviewFileSummary,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';
import type { GetWorkspaceGitStatusResult } from '../../src/shared/ipc/contracts/workspace-git';
import { createTestQueryClient } from './support/dom';

const WORKSPACE_CWD = '/tmp/gluck';
const BRANCH_SCOPE_KEY = 'branch:master';

const changedFile: ReviewFileSummary = {
	additions: 10,
	contentId: null,
	deletions: 3,
	id: 'f1',
	path: 'src/a.ts',
	status: 'modified',
};

const otherFile: ReviewFileSummary = {
	additions: 1,
	contentId: null,
	deletions: 1,
	id: 'f2',
	path: 'src/b.ts',
	status: 'modified',
};

const renamedFile: ReviewFileSummary = {
	additions: 2,
	contentId: null,
	deletions: 0,
	id: 'f3',
	path: 'src/new-name.ts',
	renamedFrom: 'src/old-name.ts',
	status: 'renamed',
};

function statusOf(
	files: readonly ReviewFileSummary[],
): GetWorkspaceGitStatusResult {
	return {
		files: files.map((file) => ({
			additions: file.additions,
			deletions: file.deletions,
			path: file.path,
			...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
			status: file.status,
		})),
		summary: {
			additions: files.reduce((total, file) => total + file.additions, 0),
			deletions: files.reduce((total, file) => total + file.deletions, 0),
			files: files.length,
		},
	};
}

/**
 * Renders the discard hook over a query client seeded with the same change set
 * at both the working-tree and the branch scope, which is what the Changes tab
 * actually shows.
 */
function renderDiscardChanges(files: readonly ReviewFileSummary[]) {
	const client = createTestQueryClient();
	client.setQueryData(
		ensemblrQueryKeys.workspaceGitStatus(WORKSPACE_CWD),
		statusOf(files),
	);
	client.setQueryData(
		ensemblrQueryKeys.workspaceGitStatus(WORKSPACE_CWD, BRANCH_SCOPE_KEY),
		statusOf(files),
	);
	const workspace = {
		pathLabel: WORKSPACE_CWD,
		reviewFiles: files,
	} as unknown as WorkspaceShellModel;
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const rendered = renderHook(
		() => useDiscardChanges({ sourceFiles: files, workspace }),
		{ wrapper },
	);
	return { ...rendered, client };
}

function workingTreeStatus(client: ReturnType<typeof createTestQueryClient>) {
	return client.getQueryData<GetWorkspaceGitStatusResult>(
		ensemblrQueryKeys.workspaceGitStatus(WORKSPACE_CWD),
	);
}

function branchStatus(client: ReturnType<typeof createTestQueryClient>) {
	return client.getQueryData<GetWorkspaceGitStatusResult>(
		ensemblrQueryKeys.workspaceGitStatus(WORKSPACE_CWD, BRANCH_SCOPE_KEY),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	discardWorkspaceChanges.mockResolvedValue({ discarded: ['src/a.ts'] });
});

test('a discarded file leaves the working-tree change set without waiting on git', async () => {
	const { client, result } = renderDiscardChanges([changedFile, otherFile]);

	act(() => result.current.handleDiscardFile('src/a.ts'));
	await act(async () => {
		result.current.handleDiscardConfirm();
	});

	await waitFor(() => {
		expect(workingTreeStatus(client)?.files.map((file) => file.path)).toEqual([
			'src/b.ts',
		]);
	});
	expect(workingTreeStatus(client)?.summary).toEqual({
		additions: 1,
		deletions: 1,
		files: 1,
	});
	expect(result.current.discardTarget).toBeNull();
});

test('the branch view is left to git rather than rewritten optimistically', async () => {
	const { client, result } = renderDiscardChanges([changedFile, otherFile]);
	const before = branchStatus(client);

	act(() => result.current.handleDiscardFile('src/a.ts'));
	await act(async () => {
		result.current.handleDiscardConfirm();
	});

	await waitFor(() => {
		expect(workingTreeStatus(client)?.files).toHaveLength(1);
	});
	// A file with committed *and* uncommitted changes keeps its branch row, so
	// only the refetch may narrow it.
	expect(branchStatus(client)).toBe(before);
});

test('every cached scope is refreshed, not just the working tree', async () => {
	const { client, result } = renderDiscardChanges([changedFile]);

	act(() => result.current.handleDiscardFile('src/a.ts'));
	await act(async () => {
		result.current.handleDiscardConfirm();
	});

	await waitFor(() => {
		expect(
			client.getQueryState(
				ensemblrQueryKeys.workspaceGitStatus(WORKSPACE_CWD, BRANCH_SCOPE_KEY),
			)?.isInvalidated,
		).toBe(true);
	});
	expect(
		client.getQueryState(ensemblrQueryKeys.workspaceGitStatus(WORKSPACE_CWD))
			?.isInvalidated,
	).toBe(true);
});

test('discarding a rename clears the row under both of its paths', async () => {
	discardWorkspaceChanges.mockResolvedValue({
		discarded: ['src/old-name.ts'],
	});
	const { client, result } = renderDiscardChanges([renamedFile, otherFile]);

	act(() => result.current.handleDiscardFile('src/new-name.ts'));
	expect(result.current.discardTarget?.paths).toEqual([
		'src/new-name.ts',
		'src/old-name.ts',
	]);
	await act(async () => {
		result.current.handleDiscardConfirm();
	});

	await waitFor(() => {
		expect(workingTreeStatus(client)?.files.map((file) => file.path)).toEqual([
			'src/b.ts',
		]);
	});
});

test('a partial failure drops only what git reverted and keeps the dialog open', async () => {
	discardWorkspaceChanges.mockResolvedValue({
		discarded: ['src/a.ts'],
		error: { code: 'invalid-path', message: 'nope' },
	});
	const { client, result } = renderDiscardChanges([changedFile, otherFile]);

	act(() => result.current.handleDiscardAll());
	await act(async () => {
		result.current.handleDiscardConfirm();
	});

	await waitFor(() => {
		expect(result.current.discardErrorMessage).toBeTruthy();
	});
	expect(workingTreeStatus(client)?.files.map((file) => file.path)).toEqual([
		'src/b.ts',
	]);
	expect(result.current.discardTarget).not.toBeNull();
});

test('the targeted paths report as pending only while the discard runs', async () => {
	let settle: (value: { discarded: string[] }) => void = () => {};
	discardWorkspaceChanges.mockReturnValue(
		new Promise<{ discarded: string[] }>((resolve) => {
			settle = resolve;
		}),
	);
	const { result } = renderDiscardChanges([changedFile, otherFile]);

	act(() => result.current.handleDiscardAll());
	expect(result.current.pendingDiscardPaths.size).toBe(0);

	act(() => {
		result.current.handleDiscardConfirm();
	});
	await waitFor(() => {
		expect(result.current.pendingDiscardPaths.has('src/a.ts')).toBe(true);
	});
	expect(result.current.pendingDiscardPaths.has('src/b.ts')).toBe(true);
	expect(result.current.isDiscarding).toBe(true);

	await act(async () => {
		settle({ discarded: ['src/a.ts', 'src/b.ts'] });
	});
	await waitFor(() => {
		expect(result.current.pendingDiscardPaths.size).toBe(0);
	});
	expect(result.current.isDiscarding).toBe(false);
});
