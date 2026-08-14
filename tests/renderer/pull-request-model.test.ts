import { describe, expect, test } from 'vitest';

import { buildPullRequestShellModel } from '../../src/renderer/lib/workbench/pull-request-model';
import {
	clampReviewContext,
	REVIEW_CONTEXT_CHAR_LIMIT,
} from '../../src/renderer/lib/workbench/review-context';
import type {
	GithubCommentWire,
	GithubPullRequestSnapshotWire,
	GithubPullRequestWire,
	ReviewTodoWire,
} from '../../src/shared/ipc';

const NO_CHANGES = { additions: 0, deletions: 0, files: 0 };

const NETLIFY_BOT_COMMENT_BODY = [
	'### <span aria-hidden="true">✅</span> Deploy Preview for **acme** ready!',
	'',
	'|  Name | Link |',
	'| :-: | ------- |',
	'|<span aria-hidden="true">🔨</span> Latest commit | 8f2c1a9 |',
	'|<span aria-hidden="true">🔍</span> Latest deploy log | https://app.netlify.com/sites/acme/deploys/6653f0a1 |',
	'|<span aria-hidden="true">😎</span> Deploy Preview | https://deploy-preview-7--acme.netlify.app |',
].join('\n');

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
		headRefOid: 'abc123',
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
		expect(model.isConflicting).toBe(true);
		// `blocked` covers several causes; the label names this one.
		expect(model.label).toBe('Merge conflicts');
	});

	test('a PR blocked by failing checks keeps the generic Blocked label', () => {
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

		expect(model.label).toBe('Blocked');
		expect(model.isConflicting).toBe(false);
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

	test('vercel review tooling checks never become the preview deployment', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					checks: [
						{
							bucket: 'passing',
							detailsUrl: 'https://vercel.com/vercel-agent/request-review',
							id: 'c1',
							name: 'Vercel Agent Review',
						},
						{
							bucket: 'passing',
							detailsUrl: 'https://vercel.com/github',
							id: 'c2',
							name: 'Vercel Preview Comments',
						},
						{
							bucket: 'passing',
							detailsUrl: 'https://vercel.com/acme/app/dep123',
							id: 'c3',
							name: 'Vercel – app',
						},
					],
				}),
			),
			todos: [],
		});

		expect(model.previewDeployment?.url).toBe(
			'https://vercel.com/acme/app/dep123',
		);
		expect(model.previewDeployment?.label).toBe('Vercel – app');
	});

	test('a hosted preview URL wins over a provider dashboard link', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					checks: [
						{
							bucket: 'passing',
							detailsUrl: 'https://vercel.com/acme/app/dep123',
							id: 'c1',
							name: 'Vercel – app',
						},
						{
							bucket: 'passing',
							detailsUrl: 'https://app-git-feature-acme.vercel.app',
							id: 'c2',
							name: 'Vercel Preview',
						},
					],
				}),
			),
			todos: [],
		});

		expect(model.previewDeployment?.url).toBe(
			'https://app-git-feature-acme.vercel.app',
		);
	});

	test('the provider bot comment supplies the preview when links point at dashboards', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					checks: [
						{
							bucket: 'passing',
							detailsUrl: 'https://vercel.com/acme/app/dep123',
							id: 'c1',
							name: 'Vercel – app',
						},
					],
					comments: [
						{
							author: 'vercel',
							body: '| [app](https://vercel.com/acme/app) | [Ready](https://vercel.com/acme/app/dep123) | [Preview](https://app-git-feature-acme.vercel.app) |',
							createdAt: '2026-06-11T09:00:00Z',
							id: 'bot-1',
							isResolved: null,
							kind: 'issue-comment',
						},
					],
				}),
			),
			todos: [],
		});

		expect(model.previewDeployment?.source).toBe('pr-comment');
		expect(model.previewDeployment?.url).toBe(
			'https://app-git-feature-acme.vercel.app',
		);
		expect(model.previewDeployment?.label).toBe('Preview');
	});

	test('a preview URL in a human comment is not treated as the deployment', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					comments: [
						{
							author: 'octocat',
							body: 'Looks broken on https://app-git-old-acme.vercel.app',
							createdAt: '2026-06-11T09:00:00Z',
							id: 'human-1',
							isResolved: null,
							kind: 'issue-comment',
						},
					],
				}),
			),
			todos: [],
		});

		expect(model.previewDeployment).toBeUndefined();
	});

	test('netlify deploy-preview comment is recognized', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					comments: [
						{
							author: 'netlify[bot]',
							body: NETLIFY_BOT_COMMENT_BODY,
							createdAt: '2026-06-11T09:00:00Z',
							id: 'bot-1',
							isResolved: null,
							kind: 'issue-comment',
						},
					],
				}),
			),
			todos: [],
		});

		expect(model.previewDeployment?.provider).toBe('netlify');
		expect(model.previewDeployment?.url).toBe(
			'https://deploy-preview-7--acme.netlify.app',
		);
	});

	test('a later bot comment supplies the preview when an earlier one links only a dashboard', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					comments: [
						{
							author: 'netlify[bot]',
							body: 'Deploy log: https://app.netlify.com/sites/acme/deploys/6653f0a1',
							createdAt: '2026-06-11T09:00:00Z',
							id: 'bot-1',
							isResolved: null,
							kind: 'issue-comment',
						},
						{
							author: 'netlify[bot]',
							body: NETLIFY_BOT_COMMENT_BODY,
							createdAt: '2026-06-11T09:05:00Z',
							id: 'bot-2',
							isResolved: null,
							kind: 'issue-comment',
						},
					],
				}),
			),
			todos: [],
		});

		expect(model.previewDeployment?.source).toBe('pr-comment');
		expect(model.previewDeployment?.url).toBe(
			'https://deploy-preview-7--acme.netlify.app',
		);
	});

	test('a hosted preview check survives a review-tooling word in its label', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					checks: [
						{
							bucket: 'passing',
							detailsUrl:
								'https://code-review-tool-git-feature-acme.vercel.app',
							id: 'c1',
							name: 'Vercel – code-review-tool',
						},
					],
				}),
			),
			todos: [],
		});

		expect(model.previewDeployment?.url).toBe(
			'https://code-review-tool-git-feature-acme.vercel.app',
		);
	});

	test('a hosted deployment URL outranks an earlier dashboard-only deployment', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					deployments: [
						{
							environment: 'Inspect – app',
							id: 'd1',
							source: 'github-deployment',
							state: 'success',
							url: 'https://vercel.com/acme/app/dep123',
						},
						{
							environment: 'Preview – app',
							id: 'd2',
							source: 'github-deployment',
							state: 'success',
							url: 'https://app-git-feature-acme.vercel.app',
						},
					],
				}),
			),
			todos: [],
		});

		expect(model.previewDeployment?.url).toBe(
			'https://app-git-feature-acme.vercel.app',
		);
		expect(model.previewDeployment?.label).toBe('Preview – app');
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
					origin: 'user',
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

	test('sync errors are translated alongside cached PR data', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(createPullRequest()),
			syncFailure: {
				code: 'detached-head',
				message: 'could not determine current branch: not on any branch',
				output: 'could not determine current branch: not on any branch',
			},
			todos: [],
		});

		expect(model.syncError?.message).toBe(
			'This workspace is not on a branch, so GitHub has nothing to match it against. Check out a branch, then retry.',
		);
		expect(model.detail).toContain('not on a branch');
		expect(model.number).toBe(7);
	});

	test('gh output is demoted to the detail slot, never used as the explanation', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: null,
			syncFailure: {
				code: 'command-failed',
				message: 'fatal: could not read Username for https://github.com',
				output: 'fatal: could not read Username for https://github.com',
			},
			todos: [],
		});

		expect(model.syncError?.detail).toBe(
			'fatal: could not read Username for https://github.com',
		);
		expect(model.syncError?.message).toBe('The command failed.');
	});

	test('gh output that only repeats the explanation is dropped', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: null,
			syncFailure: {
				code: 'no-remote',
				message: 'This repository has no remote configured.',
				output: 'This repository has no remote configured.',
			},
			todos: [],
		});

		expect(model.syncError?.detail).toBeUndefined();
	});

	// gh wrote nothing, so `message` is main's own English fallback. Demoting it
	// would put an untranslated sentence in a Russian panel dressed as gh output.
	test('main’s fallback prose is never demoted as gh output', () => {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: null,
			syncFailure: {
				code: 'command-failed',
				message: 'gh pr view failed in workspace.',
			},
			todos: [],
		});

		expect(model.syncError?.detail).toBeUndefined();
		expect(model.syncError?.message).toBe('The command failed.');
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

describe('comment summaries', () => {
	/**
	 * Build a model whose PR carries one GitHub comment.
	 * @param comment - The comment fields to place on the pull request
	 * @returns The single comment summary the model produced
	 */
	function summarize(comment: Partial<GithubCommentWire>) {
		const model = buildPullRequestShellModel({
			changeSummary: NO_CHANGES,
			localComments: [],
			snapshot: createSnapshot(
				createPullRequest({
					comments: [
						{
							author: 'octocat',
							body: '',
							createdAt: '2026-07-20T09:00:00.000Z',
							id: 'c1',
							isResolved: null,
							kind: 'review-comment',
							...comment,
						},
					],
				}),
			),
			todos: [],
		});
		return model.comments[0];
	}

	test('the full body travels to the renderer, not just its first line', () => {
		const summary = summarize({ body: 'Line one\n\nLine two' });

		expect(summary?.body).toBe('Line one\n\nLine two');
	});

	test('the row detail drops the author, which the row already renders', () => {
		const summary = summarize({ body: 'needs a guard' });

		expect(summary?.detail).toBe('needs a guard');
	});

	test('a body opening with a blank line still summarizes, rather than reading as empty', () => {
		const summary = summarize({
			body: '\n**Warning:** unchecked cast',
			line: 57,
			path: 'src/app/page.tsx',
		});

		expect(summary?.detail).toBe('Warning: unchecked cast');
	});

	test("a bot's metadata blob is stripped from both the body and the summary", () => {
		const summary = summarize({
			body: '[vc]: #Un4Opd4tSVroIz2CPCZ3Oikl6ACPaRKqIX4FhWyWCdo=:eyJpc01vbm9yZXBv\n\nPreview ready',
			isBot: true,
		});

		expect(summary?.body).toBe('Preview ready');
		expect(summary?.detail).toBe('Preview ready');
	});

	test('a body-less thread falls back to its diff location', () => {
		const summary = summarize({
			body: '',
			line: 57,
			path: 'src/app/page.tsx',
		});

		expect(summary?.detail).toBe('src/app/page.tsx:57');
	});

	test('the diff anchor, timestamp, and replies ride along for the preview', () => {
		const summary = summarize({
			body: 'needs a guard',
			isOutdated: true,
			line: 57,
			path: 'src/app/page.tsx',
			replies: [
				{
					author: 'octocat',
					body: 'Fixed.',
					createdAt: '2026-07-20T10:00:00.000Z',
					id: 'c2',
					isResolved: null,
					kind: 'review-comment',
				},
			],
		});

		expect(summary).toMatchObject({
			createdAt: '2026-07-20T09:00:00.000Z',
			isOutdated: true,
			line: 57,
			path: 'src/app/page.tsx',
			replies: [
				{
					author: 'octocat',
					body: 'Fixed.',
					createdAt: '2026-07-20T10:00:00.000Z',
					id: 'c2',
				},
			],
		});
	});
});

describe('review context formatting', () => {
	test('clampReviewContext truncates oversized payloads with a marker', () => {
		const text = clampReviewContext('x'.repeat(REVIEW_CONTEXT_CHAR_LIMIT + 10));

		expect(text.length).toBeLessThan(REVIEW_CONTEXT_CHAR_LIMIT + 100);
		expect(text).toContain('[truncated');
	});
});
