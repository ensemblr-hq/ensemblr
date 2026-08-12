import { getDefaultWorkspace } from '@/renderer/fixtures/workbench';
import type {
	ReviewFileSummary,
	WorkspaceLandingSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { GetWorkspaceMergeConflictsResult } from '@/shared/ipc/contracts/workspace-git';

import { readBridgeWorkspaceCwd } from './bridge';

/** Worktree the trial-merge bridge handler answers for. */
const CONFLICTED_WORKSPACE_CWD = '/tmp/playground-conflicts';

/** Base branch the conflicted branch is measured against. */
const BASE_BRANCH = 'master';

/**
 * The paths a trial merge reports for a branch nobody has started merging.
 * Mostly files the branch itself touched, which is the usual case, plus one it
 * did not — the base moved a file this branch never opened — so the scene shows
 * the checks panel naming a conflict the Changes list has no row for.
 */
export const PROBED_CONFLICT_PATHS = [
	'docs/agent-control.md',
	'src/renderer/components/workbench-shell/review-files/review-file-row.tsx',
	'src/renderer/styles/index.css',
] as const;

/**
 * The change set behind both scenes, mirroring a real review: a few files git
 * could not merge, and a longer clean tail that has to stay readable under them.
 */
export const CONFLICTED_REVIEW_FILES: readonly ReviewFileSummary[] = [
	{
		additions: 28,
		contentId: null,
		deletions: 0,
		id: 'git:playground/playground.tsx',
		path: 'playground/playground.tsx',
		status: 'conflicted',
	},
	{
		additions: 85,
		contentId: null,
		deletions: 18,
		id: 'git:src/renderer/components/workbench-shell/review-files/review-file-list.tsx',
		path: 'src/renderer/components/workbench-shell/review-files/review-file-list.tsx',
		status: 'conflicted',
	},
	{
		additions: 48,
		contentId: null,
		deletions: 112,
		id: 'git:src/renderer/components/workbench-shell/review-files/review-file-row.tsx',
		path: 'src/renderer/components/workbench-shell/review-files/review-file-row.tsx',
		status: 'conflicted',
	},
	{
		additions: 9,
		contentId: null,
		deletions: 1,
		id: 'git:.fallowrc.jsonc',
		path: '.fallowrc.jsonc',
		status: 'modified',
	},
	{
		additions: 167,
		contentId: null,
		deletions: 9,
		id: 'git:docs/agent-control.md',
		path: 'docs/agent-control.md',
		status: 'modified',
	},
	{
		additions: 6,
		contentId: null,
		deletions: 0,
		id: 'git:docs/considerations/agent-control-layer.md',
		path: 'docs/considerations/agent-control-layer.md',
		status: 'added',
	},
	{
		additions: 1,
		contentId: null,
		deletions: 1,
		id: 'git:docs/harnesses.md',
		path: 'docs/harnesses.md',
		status: 'modified',
	},
];

/** Paths in the change set that git marked unmerged. */
export const WORKTREE_CONFLICT_PATHS: readonly string[] =
	CONFLICTED_REVIEW_FILES.filter((file) => file.status === 'conflicted').map(
		(file) => file.path,
	);

/** Landing summary carrying the base branch the conflict probe needs. */
function conflictLandingSummary(): WorkspaceLandingSummary {
	return {
		branchSource: {
			baseBranch: BASE_BRANCH,
			branchName: 'octocat/merge-conflicts',
			detail: `Branched from ${BASE_BRANCH}`,
		},
		copiedFiles: { count: 0, detail: 'Nothing to copy', state: 'copied' },
		headline: 'Workspace ready',
		kind: 'local-branch',
		repositoryName: 'florence',
		setupGuidance: { detail: 'No setup needed', state: 'configured' },
		workspaceName: 'merge-conflicts',
	};
}

/**
 * A workspace whose PR GitHub reports as conflicting.
 * @param hasUnmergedWorktree - Whether git has already marked files unmerged,
 *   which makes the checks panel read them instead of running a trial merge.
 * @returns The workspace model the conflict scenes drive.
 */
export function conflictedWorkspace(
	hasUnmergedWorktree: boolean,
): WorkspaceShellModel {
	const workspace = getDefaultWorkspace();
	return {
		...workspace,
		id: 'playground-conflicts',
		landingSummary: conflictLandingSummary(),
		pathLabel: CONFLICTED_WORKSPACE_CWD,
		pullRequest: {
			...workspace.pullRequest,
			checks: [],
			comments: [],
			description: [],
			detail: 'Merge conflicts must be resolved.',
			gitStatus: {
				kind: 'clean',
				label: 'Up to date with remote',
				status: 'open',
			},
			isConflicting: true,
			label: 'Merge conflicts',
			number: 214,
			state: 'open',
			status: 'blocked',
			title: 'Surface merge conflicts in the review surfaces',
			todos: [],
			url: 'https://github.com/example/florence/pull/214',
		},
		reviewFiles: hasUnmergedWorktree
			? [...CONFLICTED_REVIEW_FILES]
			: CONFLICTED_REVIEW_FILES.map((file) =>
					file.status === 'conflicted'
						? { ...file, status: 'modified' as const }
						: file,
				),
	};
}

/**
 * Bridge handler for the trial-merge probe. Registered on the bridge rather than
 * seeded into the query cache because the real query polls on an interval and
 * would overwrite a seeded value with the no-op's `undefined`.
 * @param payload - The `getWorkspaceMergeConflicts` request from the renderer.
 * @returns The conflicting paths for the playground worktree, else none.
 */
export function resolveFixtureMergeConflicts(
	payload: unknown,
): GetWorkspaceMergeConflictsResult {
	if (readBridgeWorkspaceCwd(payload) !== CONFLICTED_WORKSPACE_CWD) {
		return { paths: [] };
	}
	return { paths: [...PROBED_CONFLICT_PATHS] };
}
