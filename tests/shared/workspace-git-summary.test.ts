import { describe, expect, it } from 'vitest';
import type { WorkspaceGitFileWire } from '@/shared/ipc/contracts/workspace-git';
import { summarizeWorkspaceGitFiles } from '@/shared/ipc/contracts/workspace-git';

function file(
	overrides: Partial<WorkspaceGitFileWire> & { path: string },
): WorkspaceGitFileWire {
	return {
		additions: 0,
		deletions: 0,
		status: 'modified',
		...overrides,
	};
}

describe('summarizeWorkspaceGitFiles', () => {
	it('totals additions and deletions across the rows', () => {
		const result = summarizeWorkspaceGitFiles([
			file({ additions: 10, deletions: 3, path: 'a.ts' }),
			file({ additions: 1, deletions: 7, path: 'b.ts' }),
		]);

		expect(result.summary).toEqual({ additions: 11, deletions: 10, files: 2 });
	});

	it('counts a binary row without letting its null counts poison the totals', () => {
		const result = summarizeWorkspaceGitFiles([
			file({ additions: 4, deletions: 0, path: 'a.ts' }),
			file({ additions: null, deletions: null, path: 'logo.png' }),
		]);

		expect(result.summary).toEqual({ additions: 4, deletions: 0, files: 2 });
	});

	it('summarizes an empty change set as all zeroes', () => {
		expect(summarizeWorkspaceGitFiles([]).summary).toEqual({
			additions: 0,
			deletions: 0,
			files: 0,
		});
	});

	it('hands the rows back untouched', () => {
		const files = [file({ path: 'a.ts' })];

		expect(summarizeWorkspaceGitFiles(files).files).toBe(files);
	});
});
