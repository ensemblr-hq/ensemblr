import { expect, test } from 'vitest';

import {
	groupReviewFilesByConflict,
	mapGitStatusToReviewFiles,
	markConflictedFiles,
} from '../../src/renderer/lib/workbench/review-files';
import type { ReviewFileSummary } from '../../src/renderer/types/workbench';
import type { WorkspaceGitFileWire } from '../../src/shared/ipc/contracts/workspace-git';

function wireFile(
	overrides: Partial<WorkspaceGitFileWire> & Pick<WorkspaceGitFileWire, 'path'>,
): WorkspaceGitFileWire {
	return {
		additions: 0,
		deletions: 0,
		status: 'modified',
		...overrides,
	};
}

test('a conflicted row keeps its status instead of reading as modified', () => {
	const [file] = mapGitStatusToReviewFiles([
		wireFile({
			additions: 28,
			path: 'playground/playground.tsx',
			status: 'conflicted',
		}),
	]);

	expect(file?.status).toBe('conflicted');
	expect(file?.additions).toBe(28);
});

test('ignored rows are dropped and every other status carries through', () => {
	const files = mapGitStatusToReviewFiles([
		wireFile({ path: 'a.ts', status: 'added' }),
		wireFile({ path: 'node_modules/x.js', status: 'ignored' }),
		wireFile({ path: 'b.ts', status: 'conflicted' }),
		wireFile({ path: 'c.ts', status: 'untracked' }),
	]);

	expect(files.map((file) => [file.path, file.status])).toEqual([
		['a.ts', 'added'],
		['b.ts', 'conflicted'],
		['c.ts', 'untracked'],
	]);
});

test('null line counts become zero and a missing content stamp becomes null', () => {
	const [file] = mapGitStatusToReviewFiles([
		wireFile({ additions: null, deletions: null, path: 'logo.png' }),
	]);

	expect(file?.additions).toBe(0);
	expect(file?.deletions).toBe(0);
	expect(file?.contentId).toBeNull();
});

test('a rename carries its original path so a discard can restore it', () => {
	const [file] = mapGitStatusToReviewFiles([
		wireFile({ path: 'new.ts', renamedFrom: 'old.ts', status: 'renamed' }),
	]);

	expect(file?.renamedFrom).toBe('old.ts');
	expect(file?.id).toBe('git:new.ts');
});

function summary(path: string): ReviewFileSummary {
	return {
		additions: 1,
		contentId: null,
		deletions: 0,
		id: `git:${path}`,
		path,
		status: 'modified',
	};
}

test('conflicts group ahead of the rest, keeping their natural order', () => {
	const files = [summary('a.ts'), summary('b.ts'), summary('c.ts')];
	// The flat list would have sunk b.ts for being viewed.
	const ordered = [files[0], files[2], files[1]] as ReviewFileSummary[];

	const groups = groupReviewFilesByConflict(
		files,
		ordered,
		new Set(['b.ts', 'a.ts']),
	);

	expect(groups?.conflicted.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
	expect(groups?.clean.map((file) => file.path)).toEqual(['c.ts']);
});

test('no grouping when the conflict set is empty or misses the change set', () => {
	const files = [summary('a.ts')];

	expect(groupReviewFilesByConflict(files, files, undefined)).toBeNull();
	expect(groupReviewFilesByConflict(files, files, new Set())).toBeNull();
	expect(
		groupReviewFilesByConflict(files, files, new Set(['elsewhere.ts'])),
	).toBeNull();
});

test('a trial-merge conflict is restated as row status, leaving the rest alone', () => {
	const files = [summary('a.ts'), summary('b.ts')];

	const marked = markConflictedFiles(files, new Set(['b.ts']));

	expect(marked.map((file) => [file.path, file.status])).toEqual([
		['a.ts', 'modified'],
		['b.ts', 'conflicted'],
	]);
	// The untouched row keeps its identity so memoized consumers see no change.
	expect(marked[0]).toBe(files[0]);
	expect(files[1]?.status).toBe('modified');
});

test('marking is a no-op without a conflict set, returning the same array', () => {
	const files = [summary('a.ts')];

	expect(markConflictedFiles(files, undefined)).toBe(files);
	expect(markConflictedFiles(files, new Set())).toBe(files);
	expect(markConflictedFiles(files, new Set(['elsewhere.ts']))).toEqual(files);
});
