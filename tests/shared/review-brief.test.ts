import { describe, expect, it } from 'vitest';

import { composeActionPrompt } from '../../src/renderer/lib/workbench/action-prompts.ts';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import {
	composeReviewBrief,
	REVIEW_BASE_PROMPT,
	REVIEW_CONTEXT_CHAR_LIMIT,
} from '../../src/shared/review-brief.ts';

/** The changed files both paths list, in the order they list them. */
const CHANGED_FILES = [
	{
		additions: 12,
		deletions: 3,
		path: 'src/main/thing.ts',
		status: 'modified',
	},
	{ additions: 40, deletions: 0, path: 'src/main/other.ts', status: 'added' },
];

/**
 * A workspace shell model carrying only the fields the review prompt reads. Cast
 * rather than fully built: the model has ~30 fields the review path never
 * touches, and spelling them out would assert a shape this test is not about.
 */
function workspaceModel(
	overrides: Partial<{
		baseBranch: string | null;
		branchName: string;
		pullRequest: { number?: number; state?: string; url?: string };
		reviewFiles: typeof CHANGED_FILES;
	}> = {},
): WorkspaceShellModel {
	const pullRequest = overrides.pullRequest ?? {};
	return {
		branchName: overrides.branchName ?? 'psoldunov/thing',
		landingSummary: {
			branchSource: {
				baseBranch:
					overrides.baseBranch === undefined ? 'master' : overrides.baseBranch,
			},
		},
		pullRequest: { checks: [], ...pullRequest },
		reviewFiles: overrides.reviewFiles ?? CHANGED_FILES,
	} as unknown as WorkspaceShellModel;
}

// The Review button composes this prompt in the renderer and `startReview`
// composes it in main. Two processes rendering one prompt is exactly the shape
// that drifts, so the parity is asserted rather than assumed.
describe('review brief parity with the Review button', () => {
	it('renders byte-identical output for the same workspace', () => {
		const workspace = workspaceModel();

		expect(
			composeReviewBrief({
				baseBranch: 'master',
				branchName: 'psoldunov/thing',
				changedFiles: CHANGED_FILES,
				preferences: '',
				pullRequest: null,
			}),
		).toBe(
			composeActionPrompt({ action: 'review', preferences: '', workspace }),
		);
	});

	it('renders byte-identical output with a pull request and preferences', () => {
		const workspace = workspaceModel({
			pullRequest: { number: 42, url: 'https://example.test/pr/42' },
		});

		expect(
			composeReviewBrief({
				baseBranch: 'master',
				branchName: 'psoldunov/thing',
				changedFiles: CHANGED_FILES,
				preferences: 'Focus on the error paths.',
				pullRequest: { number: 42, url: 'https://example.test/pr/42' },
			}),
		).toBe(
			composeActionPrompt({
				action: 'review',
				preferences: 'Focus on the error paths.',
				workspace,
			}),
		);
	});

	it('renders byte-identical output for a workspace with no base branch', () => {
		const workspace = workspaceModel({ baseBranch: null, reviewFiles: [] });

		expect(
			composeReviewBrief({
				baseBranch: null,
				branchName: 'psoldunov/thing',
				changedFiles: [],
				preferences: '',
				pullRequest: null,
			}),
		).toBe(
			composeActionPrompt({ action: 'review', preferences: '', workspace }),
		);
	});
});

describe('review brief composition', () => {
	const brief = composeReviewBrief({
		baseBranch: 'master',
		branchName: 'psoldunov/thing',
		changedFiles: CHANGED_FILES,
		preferences: '',
		pullRequest: null,
	});

	it('interpolates the branch and its base into the guidelines', () => {
		expect(brief).toContain('psoldunov/thing');
		expect(brief).toContain('origin/master');
		expect(brief).not.toMatch(/\$\{\w+\}/);
	});

	it('names the base branch generically when the workspace records none', () => {
		expect(
			composeReviewBrief({
				baseBranch: null,
				branchName: 'psoldunov/thing',
				changedFiles: [],
				preferences: '',
				pullRequest: null,
			}),
		).toContain('origin/the base branch');
	});

	it('lists the changed files with their line counts', () => {
		expect(brief).toContain('- src/main/thing.ts (modified, +12/-3)');
		expect(brief).toContain('- src/main/other.ts (added, +40/-0)');
	});

	it('tells the reviewer to work from the branch diff when nothing is changed', () => {
		expect(
			composeReviewBrief({
				baseBranch: 'master',
				branchName: 'psoldunov/thing',
				changedFiles: [],
				preferences: '',
				pullRequest: null,
			}),
		).toContain('work against the branch diff');
	});

	// The user's own instructions are appended after the clamp so a wide
	// changed-files list can never truncate them — or the header that gives them
	// precedence — away.
	it('keeps the user preferences whole past the context cap', () => {
		const wide = Array.from({ length: 4_000 }, (_, index) => ({
			additions: 1,
			deletions: 1,
			path: `src/generated/file-${index}.ts`,
			status: 'added',
		}));

		const composed = composeReviewBrief({
			baseBranch: 'master',
			branchName: 'psoldunov/thing',
			changedFiles: wide,
			preferences: 'Only flag security findings.',
			pullRequest: null,
		});

		expect(composed).toContain('truncated');
		expect(composed).toContain('Only flag security findings.');
		expect(composed).toContain(
			"The following are the user's custom preferences",
		);
		expect(composed.length).toBeGreaterThan(REVIEW_CONTEXT_CHAR_LIMIT);
	});

	// The skill deference shipped in #446 is the part that makes a repository's
	// own review policy win, and it has to survive both composition paths.
	it('defers to the repository’s own review skill before the built-in guidelines', () => {
		expect(REVIEW_BASE_PROMPT).toContain(
			"Check for the user's own review skill first",
		);
		expect(brief).toContain('It replaces every guideline below');
	});
});
