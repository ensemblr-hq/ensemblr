import { expect, test } from 'vitest';

import { hasReviewableChanges } from '../../src/renderer/lib/workbench/review-presence';
import type { GetWorkspaceGitStatusResult } from '../../src/shared/ipc/contracts/workspace-git';

function status(files: number): GetWorkspaceGitStatusResult {
	return {
		files: [],
		summary: { additions: 0, deletions: 0, files },
	};
}

test('uses the branch diff when present: non-empty → reviewable', () => {
	// Working tree clean (0) but the branch is ahead of base — still reviewable.
	expect(hasReviewableChanges(status(3), 0)).toBe(true);
});

test('uses the branch diff when present: empty → not reviewable', () => {
	expect(hasReviewableChanges(status(0), 0)).toBe(false);
});

test('branch diff takes precedence over a dirty working-tree count', () => {
	// Branch status is present and empty — it wins even if the working-tree count
	// disagrees, so the affordance stays hidden.
	expect(hasReviewableChanges(status(0), 5)).toBe(false);
});

test('errored branch status falls back to the working-tree count', () => {
	const errored: GetWorkspaceGitStatusResult = {
		error: { code: 'command-failed', message: 'boom' },
		files: [],
		summary: { additions: 0, deletions: 0, files: 0 },
	};
	expect(hasReviewableChanges(errored, 2)).toBe(true);
	expect(hasReviewableChanges(errored, 0)).toBe(false);
});

test('missing branch status falls back to the working-tree count', () => {
	expect(hasReviewableChanges(undefined, 1)).toBe(true);
	expect(hasReviewableChanges(undefined, 0)).toBe(false);
});
