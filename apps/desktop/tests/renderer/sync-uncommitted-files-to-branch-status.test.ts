import { describe, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { syncUncommittedFilesToBranchStatus } from '../../src/renderer/api/ensemblr/workspace-git';
import type { GetWorkspaceGitStatusResult } from '../../src/shared/ipc/contracts/workspace-git';
import { createTestQueryClient } from './support/dom';

const WORKSPACE_CWD = '/repo/feature';
const BRANCH_KEY = ensemblrQueryKeys.workspaceGitStatus(
	WORKSPACE_CWD,
	'branch:main',
);
const WORKING_TREE_KEY = ensemblrQueryKeys.workspaceGitStatus(WORKSPACE_CWD);
const OTHER_BRANCH_KEY = ensemblrQueryKeys.workspaceGitStatus(
	'/repo/other',
	'branch:main',
);

/** A branch-scoped status whose working tree held `uncommittedFiles` edits. */
function branchStatus(uncommittedFiles: number): GetWorkspaceGitStatusResult {
	return {
		files: [
			{ additions: 4, deletions: 1, path: 'a.ts', status: 'modified' },
			{ additions: 9, deletions: 0, path: 'b.ts', status: 'added' },
		],
		summary: { additions: 13, deletions: 1, files: 2 },
		uncommittedFiles,
	};
}

/** Seeds one branch entry per workspace plus the open workspace's working tree. */
function seededClient() {
	const client = createTestQueryClient();
	client.setQueryData(BRANCH_KEY, branchStatus(2), { updatedAt: 1_000 });
	client.setQueryData(OTHER_BRANCH_KEY, branchStatus(2), { updatedAt: 1_000 });
	client.setQueryData<GetWorkspaceGitStatusResult>(
		WORKING_TREE_KEY,
		{ files: [], summary: { additions: 0, deletions: 0, files: 0 } },
		{ updatedAt: 5_000 },
	);
	return client;
}

describe('syncUncommittedFilesToBranchStatus', () => {
	test('a commit seen by the working-tree read clears the branch count', () => {
		const client = seededClient();
		const before = client.getQueryData<GetWorkspaceGitStatusResult>(BRANCH_KEY);

		syncUncommittedFilesToBranchStatus(client, {
			observedAt: 5_000,
			uncommittedFiles: 0,
			workspaceCwd: WORKSPACE_CWD,
		});

		const after = client.getQueryData<GetWorkspaceGitStatusResult>(BRANCH_KEY);
		expect(after?.uncommittedFiles).toBe(0);
		expect(after?.files).toBe(before?.files);
		expect(after?.summary).toEqual(before?.summary);
		expect(client.getQueryState(BRANCH_KEY)?.dataUpdatedAt).toBe(5_000);
	});

	test('leaves other workspaces and scopes without a count alone', () => {
		const client = seededClient();
		const workingTree = client.getQueryData(WORKING_TREE_KEY);

		syncUncommittedFilesToBranchStatus(client, {
			observedAt: 5_000,
			uncommittedFiles: 0,
			workspaceCwd: WORKSPACE_CWD,
		});

		expect(
			client.getQueryData<GetWorkspaceGitStatusResult>(OTHER_BRANCH_KEY)
				?.uncommittedFiles,
		).toBe(2);
		expect(client.getQueryData(WORKING_TREE_KEY)).toBe(workingTree);
		expect(client.getQueryState(WORKING_TREE_KEY)?.dataUpdatedAt).toBe(5_000);
	});

	test('an unchanged count writes nothing', () => {
		const client = seededClient();
		const before = client.getQueryData(BRANCH_KEY);

		syncUncommittedFilesToBranchStatus(client, {
			observedAt: 9_000,
			uncommittedFiles: 2,
			workspaceCwd: WORKSPACE_CWD,
		});

		expect(client.getQueryData(BRANCH_KEY)).toBe(before);
		expect(client.getQueryState(BRANCH_KEY)?.dataUpdatedAt).toBe(1_000);
	});

	test('an older working-tree read never overwrites a newer branch count', () => {
		const client = seededClient();
		client.setQueryData(BRANCH_KEY, branchStatus(0), { updatedAt: 9_000 });
		const before = client.getQueryData(BRANCH_KEY);

		syncUncommittedFilesToBranchStatus(client, {
			observedAt: 5_000,
			uncommittedFiles: 3,
			workspaceCwd: WORKSPACE_CWD,
		});

		expect(client.getQueryData(BRANCH_KEY)).toBe(before);
		expect(client.getQueryState(BRANCH_KEY)?.dataUpdatedAt).toBe(9_000);
	});
});
