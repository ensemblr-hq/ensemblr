import { PullRequestCommentRow } from '@/renderer/components/workbench-shell/checks-panel/pr-rows';
import { CommentPreviewPanel } from '@/renderer/components/workbench-shell/conversation-panel/comment-preview-panel';
import { buildPullRequestShellModel } from '@/renderer/lib/workbench/pull-request-model';
import type { GithubCommentWire } from '@/shared/ipc/contracts/github';

/**
 * The comment shapes that used to read as noise: Vercel's base64 state blob, a
 * bot marker followed by a blank line, and a thread whose head comment carries
 * no prose at all. Driving the real mapper with these proves the row summary and
 * the preview both recover something a human can read.
 */
const COMMENTS: GithubCommentWire[] = [
	{
		author: 'vercel',
		body: [
			'[vc]: #Un4Opd4tSVroIz2CPCZ3Oikl6ACPaRKqIX4FhWyWCdo=:eyJpc01vbm9yZXBvIjp0cnVlLCJ0eXBlIjoiZ2l0aHViIn0=',
			'The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).',
			'',
			'| Project | Deployment | Actions | Updated (UTC) |',
			'| :--- | :----- | :------ | :------ |',
			'| <a href="https://vercel.com/almost-always/inherence-dev"><sup><img src="https://vercel.com/api/www/avatar?projectId=prj_i7a8&teamId=team_WVtS&s=32" width="16" height="16" align="middle" alt="" /></sup></a> [inherence-dev](https://vercel.com/almost-always/inherence-dev) | ![Ready](https://vercel.com/static/status/ready.svg) [Ready](https://vercel.com/almost-always/inherence-dev/9BrxSVBp8f1xECeMNFLxEz9eD2od) | [Preview](https://inherence-dev-git-psoldunov-import-cryptog-a81bba-almost-always.vercel.app) | Aug 4, 2026 6:33am |',
			'',
		].join('\n'),
		createdAt: '2026-08-04T09:12:00.000Z',
		id: 'vercel-1',
		isBot: true,
		isResolved: null,
		kind: 'issue-comment',
		url: 'https://github.com/acme/app/pull/42#issuecomment-1',
	},
	{
		author: 'github-actions',
		body: [
			'<!-- react-doctor:summary -->',
			'',
			'## React Doctor found 2 issues',
			'',
			'- `no-render-phase-prev-props` in `src/app/(site)/cryptography/page.tsx`',
			'- `no-unstable-context-value` in `src/app/providers.tsx`',
			'',
			'```tsx',
			'const value = useMemo(() => ({ user, signOut }), [user, signOut]);',
			'```',
		].join('\n'),
		createdAt: '2026-08-04T09:20:00.000Z',
		id: 'actions-1',
		isBot: true,
		isResolved: null,
		kind: 'issue-comment',
	},
	{
		author: 'github-actions',
		body: '',
		createdAt: '2026-08-04T09:24:00.000Z',
		id: 'actions-2',
		isBot: true,
		isOutdated: true,
		isResolved: false,
		kind: 'review-comment',
		line: 57,
		path: 'src/app/(site)/cryptography/page.tsx',
		replies: [
			{
				author: 'psoldunov',
				body: 'Moved the import behind `next/dynamic`, so the route stays client-safe.',
				createdAt: '2026-08-04T10:02:00.000Z',
				id: 'actions-2-reply',
				isResolved: null,
				kind: 'review-comment',
			},
		],
	},
];

const SUMMARIES = buildPullRequestShellModel({
	changeSummary: { additions: 0, deletions: 0, files: 0 },
	localComments: [],
	snapshot: {
		branchSync: {
			ahead: 0,
			behind: 0,
			branchName: 'psoldunov/import-cryptography-page',
			hasUpstream: true,
		},
		pullRequest: {
			additions: 12,
			baseRefName: 'master',
			body: '',
			checks: [],
			comments: COMMENTS,
			deletions: 3,
			deployments: [],
			headRefName: 'psoldunov/import-cryptography-page',
			headRefOid: 'abc123',
			isDraft: false,
			mergeable: 'mergeable',
			number: 42,
			state: 'open',
			title: 'Import cryptography page',
			updatedAt: '2026-08-04T10:00:00.000Z',
			url: 'https://github.com/acme/app/pull/42',
		},
		syncedAt: '2026-08-04T10:05:00.000Z',
	},
	todos: [],
}).comments;

/**
 * Comment-preview scene: the Checks-panel rows on the left and the preview tab
 * each row opens on the right, driven through the shipped mapper so the summary
 * line and the rendered body come from the same code the app runs.
 */
export function CommentPreviewScene() {
	return (
		<div className='flex flex-col gap-4'>
			<div className='flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2'>
				{SUMMARIES.map((comment) => (
					<PullRequestCommentRow comment={comment} key={comment.id} />
				))}
			</div>
			{SUMMARIES.map((comment) => (
				<div
					className='flex h-80 flex-col overflow-hidden rounded-md border border-border bg-surface'
					key={comment.id}
				>
					<CommentPreviewPanel comment={{ ...comment, prNumber: 42 }} />
				</div>
			))}
		</div>
	);
}
