import { describe, expect, test } from 'vitest';

import {
	ACTION_KEY_BY_KIND,
	buildActionAttachmentBlock,
	composeActionPrompt,
	resolvePullRequestAction,
	wrapWithMasterPrompt,
} from '../../src/renderer/lib/workbench/action-prompts';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';

/** Stable fragment of the user-preferences addon header (kept private in the module). */
const USER_PREF_ADDON_MARKER = 'These preferences take precedence';

/** Minimal workspace fixture exposing only the fields the composer reads. */
function makeWorkspace(
	overrides: Partial<WorkspaceShellModel> = {},
): WorkspaceShellModel {
	return {
		branchName: 'feature/widget',
		landingSummary: { branchSource: { baseBranch: 'main' } },
		pullRequest: {
			checks: [],
			description: [],
			number: undefined,
			title: '',
			url: undefined,
		},
		reviewFiles: [
			{ additions: 3, deletions: 1, path: 'src/a.ts', status: 'modified' },
		],
		...overrides,
	} as unknown as WorkspaceShellModel;
}

describe('composeActionPrompt', () => {
	test('interpolates branch fields and lists changed files for review', () => {
		const result = composeActionPrompt({
			action: 'review',
			preferences: '',
			workspace: makeWorkspace(),
		});
		expect(result).toContain('# Review guidelines');
		expect(result).toContain('git merge-base origin/main HEAD');
		expect(result).toContain('src/a.ts (modified, +3/-1)');
	});

	test('omits the preferences addon when preferences are empty', () => {
		const result = composeActionPrompt({
			action: 'review',
			preferences: '   ',
			workspace: makeWorkspace(),
		});
		expect(result).not.toContain(USER_PREF_ADDON_MARKER);
	});

	test('appends the addon and user preferences when provided', () => {
		const result = composeActionPrompt({
			action: 'review',
			preferences: 'Prefer functional style.',
			workspace: makeWorkspace(),
		});
		expect(result).toContain(USER_PREF_ADDON_MARKER);
		expect(result).toContain('Prefer functional style.');
	});

	test('fences the PR title and description for create-pr', () => {
		const result = composeActionPrompt({
			action: 'create-pr',
			prDescription: 'Adds the widget.',
			preferences: '',
			prTitle: 'Add widget',
			workspace: makeWorkspace(),
		});
		expect(result).toContain('gh pr create --base main');
		expect(result).toContain('<pr-title>\nAdd widget\n</pr-title>');
		expect(result).toContain(
			'<pr-description>\nAdds the widget.\n</pr-description>',
		);
	});

	/** Workspace carrying an open PR #390 with the given title and body. */
	function withOpenPullRequest(
		title: string,
		body: string,
	): WorkspaceShellModel {
		return makeWorkspace({
			pullRequest: {
				checks: [],
				description: [body],
				number: 390,
				state: 'open',
				title,
				url: 'https://github.com/acme/app/pull/390',
			},
		} as unknown as Partial<WorkspaceShellModel>);
	}

	test('points update-pr at the open PR and never at gh pr create', () => {
		const result = composeActionPrompt({
			action: 'update-pr',
			prDescription: 'Adds the widget, and the sprocket.',
			preferences: '',
			prTitle: 'Add widget and sprocket',
			workspace: withOpenPullRequest('Add widget', 'Adds the widget.'),
		});
		expect(result).toContain('gh pr edit 390 --title');
		expect(result).toContain('gh pr view 390 --json title,body');
		expect(result).toContain('never run `gh pr create`');
		expect(result).not.toContain('gh pr create --base');
		expect(result).toContain('A pull request is already open for this branch');
		expect(result).toContain('Pull request: #390');
		expect(result).toContain('src/a.ts (modified, +3/-1)');
	});

	test('fences an edited title and description as the requested ones', () => {
		const result = composeActionPrompt({
			action: 'update-pr',
			prDescription: 'Adds the widget, and the sprocket.',
			preferences: '',
			prTitle: 'Add widget and sprocket',
			workspace: withOpenPullRequest('Add widget', 'Adds the widget.'),
		});
		expect(result).toContain(
			'<pr-title>\nAdd widget and sprocket\n</pr-title>',
		);
		expect(result).toContain(
			'<pr-description>\nAdds the widget, and the sprocket.\n</pr-description>',
		);
	});

	test('does not pin update-pr to the title it was seeded from', () => {
		const result = composeActionPrompt({
			action: 'update-pr',
			prDescription: 'Adds the widget.',
			preferences: '',
			prTitle: 'Add widget',
			workspace: withOpenPullRequest('Add widget', 'Adds the widget.'),
		});
		expect(result).not.toContain('<pr-title>');
		expect(result).not.toContain('<pr-description>');
		expect(result).toContain("keep the pull request's current title");
		expect(result).toContain(
			"revise the pull request's own description against the diff",
		);
	});

	test('drops the PR number from the gh commands when there is none', () => {
		const result = composeActionPrompt({
			action: 'update-pr',
			preferences: '',
			workspace: makeWorkspace(),
		});
		expect(result).toContain('gh pr view --json title,body');
		expect(result).toContain('gh pr edit --title <title>');
		expect(result).not.toContain('gh pr view  ');
		expect(result).not.toContain('PR_NUMBER');
	});

	test('tells update-pr to force-with-lease a rebased branch', () => {
		const result = composeActionPrompt({
			action: 'update-pr',
			preferences: '',
			workspace: withOpenPullRequest('Add widget', 'Adds the widget.'),
		});
		expect(result).toContain('git push --force-with-lease');
		expect(result).toContain('differently-named upstream');
	});

	test('keeps create-pr fencing a title carried over from a merged PR', () => {
		const result = composeActionPrompt({
			action: 'create-pr',
			preferences: '',
			prTitle: 'Add widget',
			workspace: makeWorkspace({
				pullRequest: {
					checks: [],
					description: [],
					number: 390,
					state: 'merged',
					title: 'Add widget',
					url: undefined,
				},
			} as unknown as Partial<WorkspaceShellModel>),
		});
		expect(result).toContain('<pr-title>\nAdd widget\n</pr-title>');
		expect(result).toContain('gh pr create --base main');
	});

	test('keeps user preferences even when the changed-files list overflows the clamp', () => {
		const reviewFiles = Array.from({ length: 4000 }, (_, index) => ({
			additions: 1,
			deletions: 0,
			path: `src/generated/file-${index}.ts`,
			status: 'modified' as const,
		}));
		const result = composeActionPrompt({
			action: 'review',
			preferences: 'Always check for N+1 queries.',
			workspace: makeWorkspace({
				reviewFiles,
			} as Partial<WorkspaceShellModel>),
		});
		expect(result).toContain('truncated');
		expect(result).toContain(USER_PREF_ADDON_MARKER);
		expect(result).toContain('Always check for N+1 queries.');
	});

	test('falls back to the base-branch label when no landing summary exists', () => {
		const result = composeActionPrompt({
			action: 'resolve-conflicts',
			preferences: '',
			workspace: makeWorkspace({ landingSummary: undefined }),
		});
		expect(result).toContain('the base branch');
	});
});

describe('ACTION_KEY_BY_KIND', () => {
	test('maps every action kind to its settings preferences key', () => {
		expect(ACTION_KEY_BY_KIND).toEqual({
			'branch-naming': 'branchRename',
			'create-pr': 'createPr',
			'fix-check-errors': 'fixErrors',
			general: 'general',
			'resolve-conflicts': 'resolveConflicts',
			review: 'codeReview',
			'update-pr': 'createPr',
		});
	});
});

describe('resolvePullRequestAction', () => {
	/** Builds a workspace carrying the given PR number and state. */
	function withPullRequest(
		number: number | undefined,
		state?: 'closed' | 'merged' | 'open',
	): WorkspaceShellModel {
		return makeWorkspace({
			pullRequest: {
				checks: [],
				description: [],
				number,
				state,
				title: '',
				url: undefined,
			},
		} as unknown as Partial<WorkspaceShellModel>);
	}

	test('creates when the workspace has no pull request', () => {
		expect(resolvePullRequestAction(withPullRequest(undefined))).toBe(
			'create-pr',
		);
	});

	test('updates an open pull request', () => {
		expect(resolvePullRequestAction(withPullRequest(390, 'open'))).toBe(
			'update-pr',
		);
	});

	test('updates a pull request whose state has not been snapshotted yet', () => {
		expect(resolvePullRequestAction(withPullRequest(390))).toBe('update-pr');
	});

	test('creates again once the pull request is merged or closed', () => {
		expect(resolvePullRequestAction(withPullRequest(390, 'merged'))).toBe(
			'create-pr',
		);
		expect(resolvePullRequestAction(withPullRequest(390, 'closed'))).toBe(
			'create-pr',
		);
	});
});

describe('buildActionAttachmentBlock', () => {
	test('wraps content verbatim without truncation', () => {
		const content = 'x'.repeat(20_000);
		const block = buildActionAttachmentBlock(
			'.context/attachments/ensemblr-review.md',
			content,
		);
		expect(block).toContain(
			'<attached_file path=".context/attachments/ensemblr-review.md">',
		);
		expect(block).toContain(content);
		expect(block).not.toContain('elided');
	});
});

describe('wrapWithMasterPrompt', () => {
	test('prepends the preferences as a fenced context block', () => {
		const result = wrapWithMasterPrompt('Be concise.', 'Fix the bug.');
		expect(result).toBe(
			'<user_preferences>\nBe concise.\n</user_preferences>\n\nFix the bug.',
		);
	});

	test('returns the prompt unchanged when there are no preferences', () => {
		expect(wrapWithMasterPrompt('   ', 'Fix the bug.')).toBe('Fix the bug.');
	});
});
