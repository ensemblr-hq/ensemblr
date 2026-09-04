import type {
	RepositoryBranchWire,
	RepositoryIssueWire,
	RepositoryPullRequestWire,
} from '@/shared/ipc/contracts/workspace-sources';

import { DEMO_CLOCK } from './workspaces.ts';

/**
 * Builds one branch row for the create-from picker.
 *
 * `workspaceId` is what decides the row's actions: a branch an active workspace
 * already holds offers *Open* and *Duplicate branch*, and a free one offers
 * *Use branch* — so the ids here have to be real workspaces from
 * `fixtures/workspaces.ts` or the dialog offers to open a workspace that does
 * not exist.
 * @param name - Bare branch name.
 * @param workspaceId - Workspace already holding the branch, or null when free.
 * @param isDefault - True for the repository's default branch.
 * @returns The branch row the picker renders.
 */
function branch(
	name: string,
	workspaceId: string | null = null,
	isDefault = false,
): RepositoryBranchWire {
	return {
		hasWorkspace: workspaceId !== null,
		isDefault,
		name,
		workspaceId,
	};
}

/**
 * Builds one pull-request row for the create-from picker.
 * @param options - The fields that differ between pull requests.
 * @returns The pull-request row the picker renders.
 */
function pullRequest(options: {
	authorLogin: string;
	headRefName: string;
	number: number;
	title: string;
	workspaceId?: string;
}): RepositoryPullRequestWire {
	return {
		authorLogin: options.authorLogin,
		baseRefName: 'main',
		hasWorkspace: options.workspaceId !== undefined,
		headRefName: options.headRefName,
		isCrossRepository: false,
		isDraft: false,
		number: options.number,
		state: 'OPEN',
		title: options.title,
		updatedAt: DEMO_CLOCK,
		url: `https://github.com/psoldunov/ensemblr/pull/${options.number}`,
		workspaceId: options.workspaceId ?? null,
	};
}

/**
 * Builds one GitHub issue row for the create-from picker.
 * @param options - The fields that differ between issues.
 * @returns The issue row the picker renders.
 */
function githubIssue(options: {
	authorLogin: string;
	labels?: readonly string[];
	number: number;
	title: string;
}): RepositoryIssueWire {
	return {
		assigneeLogins: [],
		authorLogin: options.authorLogin,
		body: '',
		labels: [...(options.labels ?? [])],
		number: options.number,
		state: 'OPEN',
		title: options.title,
		updatedAt: DEMO_CLOCK,
		url: `https://github.com/psoldunov/ensemblr/issues/${options.number}`,
	};
}

/**
 * Remote branches per repository, in the order the picker lists them.
 *
 * The two branches the create-from shot is about lead each list: the first row
 * is one an active workspace already holds, because cmdk highlights the first
 * item and the picker only renders a row's actions while it is highlighted or
 * hovered — a held branch further down would put its *Open* and *Duplicate
 * branch* buttons off camera.
 */
export const DEMO_REPOSITORY_BRANCHES: Readonly<
	Record<string, readonly RepositoryBranchWire[]>
> = {
	'repo-atlas': [
		branch('rate-limit-headers', 'ws-rate-limit'),
		branch('main', null, true),
		branch('cursor-pagination', 'ws-cursor-pagination'),
		branch('openapi-3-1-spec'),
		branch('drop-legacy-v1-routes'),
		branch('bulk-export-endpoint'),
	],
	'repo-ensemblr': [
		branch('release-notes-in-updates-panel', 'ws-release-notes'),
		branch('main', null, true),
		branch('linux-tray-icon', 'ws-tray-icon'),
		branch('composer-attachment-chips', 'ws-attachment-chips'),
		branch('shiki-theme-cache'),
		branch('inline-command-palette'),
		branch('workspace-archive-browser'),
		branch('sqlite-wal-checkpoint'),
	],
};

/** Open pull requests per repository, as the picker's default tab lists them. */
export const DEMO_REPOSITORY_PULL_REQUESTS: Readonly<
	Record<string, readonly RepositoryPullRequestWire[]>
> = {
	'repo-atlas': [
		pullRequest({
			authorLogin: 'psoldunov',
			headRefName: 'cursor-pagination',
			number: 94,
			title: 'Cursor pagination for the list endpoints',
			workspaceId: 'ws-cursor-pagination',
		}),
		pullRequest({
			authorLogin: 'mara-ellis',
			headRefName: 'openapi-3-1-spec',
			number: 97,
			title: 'Publish the OpenAPI 3.1 spec from the route table',
		}),
		pullRequest({
			authorLogin: 'devon-park',
			headRefName: 'bulk-export-endpoint',
			number: 98,
			title: 'Bulk export endpoint with a signed download URL',
		}),
	],
	'repo-ensemblr': [
		pullRequest({
			authorLogin: 'psoldunov',
			headRefName: 'release-notes-in-updates-panel',
			number: 438,
			title: 'Show release notes in the updates panel',
			workspaceId: 'ws-release-notes',
		}),
		pullRequest({
			authorLogin: 'mara-ellis',
			headRefName: 'shiki-theme-cache',
			number: 442,
			title: 'Cache the Shiki theme between diff tabs',
		}),
		pullRequest({
			authorLogin: 'psoldunov',
			headRefName: 'diff-viewer-virtualization',
			number: 441,
			title: 'Virtualize the diff viewer for files over 4k lines',
			workspaceId: 'ws-diff-virtualization',
		}),
		pullRequest({
			authorLogin: 'devon-park',
			headRefName: 'inline-command-palette',
			number: 443,
			title: 'Open the command palette inline in the composer',
		}),
		pullRequest({
			authorLogin: 'mara-ellis',
			headRefName: 'workspace-archive-browser',
			number: 444,
			title: 'Browse archived workspaces from the repository header',
		}),
	],
};

/** Open GitHub issues per repository, shown on the picker's Issues tab. */
export const DEMO_REPOSITORY_ISSUES: Readonly<
	Record<string, readonly RepositoryIssueWire[]>
> = {
	'repo-atlas': [
		githubIssue({
			authorLogin: 'devon-park',
			labels: ['bug'],
			number: 212,
			title: 'Rate limit headers report the wrong window on burst',
		}),
		githubIssue({
			authorLogin: 'mara-ellis',
			number: 214,
			title: 'Audit log for admin actions',
		}),
	],
	'repo-ensemblr': [
		githubIssue({
			authorLogin: 'mara-ellis',
			labels: ['bug'],
			number: 619,
			title: 'Terminal repaints the whole viewport on every streamed line',
		}),
		githubIssue({
			authorLogin: 'devon-park',
			labels: ['enhancement'],
			number: 623,
			title: 'Let a workspace be renamed from the board card',
		}),
		githubIssue({
			authorLogin: 'psoldunov',
			number: 627,
			title: 'Remember the dock height per workspace',
		}),
	],
};
