import { describe, expect, test } from 'bun:test';

import { buildPullRequestShellModel } from '../../src/renderer/lib/workbench/pull-request-model';
import {
	clampReviewContext,
	formatAllCommentsContext,
	REVIEW_CONTEXT_CHAR_LIMIT,
} from '../../src/renderer/lib/workbench/review-context';
import type {
	GithubPullRequestSnapshotWire,
	GithubPullRequestWire,
	ReviewTodoWire,
} from '../../src/shared/ipc';

const NO_CHANGES = { additions: 0, deletions: 0, files: 0 };

function createPullRequest(
	overrides: Partial<GithubPullRequestWire> = {},
): GithubPullRequestWire {
	return {
		additions: 10,
		baseRefName: 'master',
		body: 'First paragraph\n\nSecond paragraph',
		checks: [],
		comments: [],
		deletions: 2,
		deployments: [],
		headRefName: 'feature/x',
		isDraft: false,
		mergeable: 'mergeable',
		number: 7,
		state: 'open',
		title: 'Add feature',
		updatedAt: '2026-06-11T10:00:00Z',
		url: 'https://github.com/o/r/pull/7',
		...overrides,
	};
}

function createSnapshot(
	pullRequest: GithubPullRequestWire | null,
): GithubPullRequestSnapshotWire {
	return {
		branchSync: {
			ahead: 0,
			behind: 0,
			branchName: 'feature/x',
			hasUpstream: true,
		},
		pullRequest,
		syncedAt: '2026-06-11T12:00:00Z',
	};
}

function createTodo(overrides: Partial<ReviewTodoWire> = {}): ReviewTodoWire {
	return {
		createdAt: '2026-06-11T09:00:00Z',
		id: 'todo-1',
		position: 0,
		status: 'open',
		title: 'Fix tests',
		updatedAt: '2026-06-11T09:00:00Z',
		workspaceId: 'ws-1',
		...overrides,
	};
}

describe('buildPullRequestShellModel', () => {
	test('no snapshot and no PR yields idle no-PR model', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(null),
			todos: [],
		});

		expect(model.status).toBe('idle');
		expect(model.number).toBeUndefined();
		expect(model.label).toBe('No PR');
		expect(model.gitStatus.status).toBe('open');
		expect(model.state).toBeUndefined();
	});

	test('uncommitted changes produce commit-and-push git status', () => {
		const model = buildPullRequestShellModel({
			changeSummary: { additions: 4, deletions: 1, files: 3 },
			localComments: [],
			snapshot: createSnapshot(null),
			todos: [],
		});

		expect(model.gitStatus.label).toBe('3 uncommitted changes');
		expect(model.gitStatus.actionLabel).toBe('Commit and push');
	});

	test('passing checks + mergeable + approval derive ready-to-merge', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					checks: [
						{ bucket: 'passing', id: 'c1', name: 'build' },
						{ bucket: 'skipped', id: 'c2', name: 'optional' },
					],
					reviewDecision: 'APPROVED',
				}),
			),
			todos: [],
		});

		expect(model.status).toBe('ready-to-merge');
		expect(model.label).toBe('Ready to merge');
		expect(model.checks).toHaveLength(2);
		expect(model.state).toBe('open');
	});

	test('failing check derives blocked status', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					checks: [{ bucket: 'failing', id: 'c1', name: 'build' }],
				}),
			),
			todos: [],
		});

		expect(model.status).toBe('blocked');
		expect(model.checks[0]?.status).toBe('blocked');
	});

	test('pending checks derive checking status', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					checks: [{ bucket: 'pending', id: 'c1', name: 'build' }],
				}),
			),
			todos: [],
		});

		expect(model.status).toBe('checking');
	});

	test('conflicting PR is blocked even with passing checks', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					checks: [{ bucket: 'passing', id: 'c1', name: 'build' }],
					mergeable: 'conflicting',
				}),
			),
			todos: [],
		});

		expect(model.status).toBe('blocked');
		expect(model.detail).toContain('conflict');
	});

	test('github deployment with URL becomes the preview deployment', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					deployments: [
						{
							environment: 'Preview',
							id: 'd1',
							source: 'github-deployment',
							state: 'success',
							url: 'https://my-app.vercel.app',
						},
					],
				}),
			),
			todos: [],
		});

		expect(model.previewDeployment?.url).toBe('https://my-app.vercel.app');
		expect(model.previewDeployment?.provider).toBe('vercel');
		expect(model.previewDeployment?.source).toBe('github-deployment');
	});

	test('vercel check link is the preview fallback', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					checks: [
						{
							bucket: 'passing',
							detailsUrl: 'https://vercel.com/deploy/1',
							id: 'c1',
							name: 'Vercel Preview',
						},
					],
				}),
			),
			todos: [],
		});

		expect(model.previewDeployment?.source).toBe('check-link');
	});

	test('todos and local comments are merged into the model', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [
				{
					body: 'Rename this',
					createdAt: '2026-06-11T09:00:00Z',
					filePath: 'src/app.ts',
					id: 'lc1',
					lineNumber: 4,
					status: 'open',
					updatedAt: '2026-06-11T09:00:00Z',
					workspaceId: 'ws-1',
				},
			],
			snapshot: createSnapshot(createPullRequest()),
			todos: [createTodo(), createTodo({ id: 'todo-2', status: 'done' })],
		});

		expect(model.todos).toHaveLength(2);
		expect(model.todos[1]?.status).toBe('done');
		expect(model.comments.some((comment) => comment.provider === 'local')).toBe(
			true,
		);
	});

	test('sync errors are preserved alongside cached PR data', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(createPullRequest()),
			syncError: 'connection refused',
			todos: [],
		});

		expect(model.syncError).toBe('connection refused');
		expect(model.detail).toContain('connection refused');
		expect(model.number).toBe(7);
	});

	test('merged PR reports merged label and idle status', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(createPullRequest({ state: 'merged' })),
			todos: [],
		});

		expect(model.label).toBe('Merged');
		expect(model.status).toBe('idle');
		expect(model.state).toBe('merged');
	});
});

describe('review context formatting', () => {
	test('all-comments context numbers each comment', () => {
		const text = formatAllCommentsContext(
			[
				{ detail: 'a: first', id: '1', provider: 'github' },
				{ detail: 'b: second', id: '2', provider: 'local' },
			],
			9,
		);

		expect(text).toContain('1. a: first');
		expect(text).toContain('2. b: second');
	});

	test('clampReviewContext truncates oversized payloads with a marker', () => {
		const text = clampReviewContext('x'.repeat(REVIEW_CONTEXT_CHAR_LIMIT + 10));

		expect(text.length).toBeLessThan(REVIEW_CONTEXT_CHAR_LIMIT + 100);
		expect(text).toContain('[truncated');
	});
});
