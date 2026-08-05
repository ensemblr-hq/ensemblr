import { getDefaultWorkspace } from '@/renderer/fixtures/workbench';
import type {
	PullRequestPreviewDeploymentSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { readBridgeWorkspaceCwd } from './bridge';

/** Workspace id whose merged PR the scene treats as user-dismissed. */
export const CONTINUED_WORKSPACE_ID = 'playground-pr-continued';

/** Baseline healthy Vercel deployment the scene's other variants are built from. */
const READY_PREVIEW_DEPLOYMENT: PullRequestPreviewDeploymentSummary = {
	label: 'Preview',
	provider: 'vercel',
	source: 'github-deployment',
	status: 'ready',
	url: 'https://ensemblr-git-the-118.vercel.app',
};

/**
 * The deployment shape a real Vercel preview arrives in: a label naming the
 * project, which the provider mark cannot stand in for and which a narrow header
 * therefore collapses. Attached to the header rows so the scene shows that.
 */
export const NAMED_PREVIEW_DEPLOYMENT: PullRequestPreviewDeploymentSummary = {
	...READY_PREVIEW_DEPLOYMENT,
	label: 'Preview – kast-calculator',
};

/**
 * Every preview-deployment shape the pill can take: both known providers, the
 * unknown fallback that shows a text label instead of a mark, and each check
 * status, since a non-ready deployment outranks the header tone.
 */
export const PREVIEW_DEPLOYMENT_VARIANTS: readonly {
	deployment: PullRequestPreviewDeploymentSummary;
	label: string;
}[] = [
	{
		deployment: READY_PREVIEW_DEPLOYMENT,
		label: 'vercel · ready',
	},
	{
		deployment: { ...READY_PREVIEW_DEPLOYMENT, status: 'pending' },
		label: 'vercel · pending',
	},
	{
		deployment: { ...READY_PREVIEW_DEPLOYMENT, status: 'blocked' },
		label: 'vercel · blocked',
	},
	{
		deployment: {
			label: 'Netlify',
			provider: 'netlify',
			source: 'check-link',
			status: 'ready',
			url: 'https://ensemblr.netlify.app',
		},
		label: 'netlify · ready',
	},
	{
		deployment: {
			label: 'staging.ensemblr.dev',
			provider: 'unknown',
			source: 'pr-comment',
			status: 'ready',
			url: 'https://staging.ensemblr.dev',
		},
		label: 'unknown provider · text label',
	},
];

/**
 * Git status of a branch that is fully published, so a fixture reaches the PR's
 * own status rather than the pending states that outrank it. Fixtures that want
 * those states pass their own summary, exactly as `buildGitStatus` would build it.
 */
const CLEAN_GIT_STATUS: WorkspaceShellModel['pullRequest']['gitStatus'] = {
	kind: 'clean',
	label: 'Up to date with remote',
	status: 'open',
};

/**
 * Builds a workspace whose pull-request slice resolves to one header state.
 * Every field the resolver reads is set explicitly so a fixture change upstream
 * cannot silently retarget a scene row at a different state.
 * @param overrides - Pull-request and change-summary fields that pick the state.
 * @returns A workspace model for a single scene row.
 */
function workspaceForState(overrides: {
	files?: number;
	gitStatus?: WorkspaceShellModel['pullRequest']['gitStatus'];
	id: string;
	label?: string;
	number?: number;
	state?: 'closed' | 'merged' | 'open';
	status?: WorkspaceShellModel['pullRequest']['status'];
	title?: string;
}): WorkspaceShellModel {
	const base = getDefaultWorkspace();
	return {
		...base,
		changeSummary: { ...base.changeSummary, files: overrides.files ?? 4 },
		githubRepo: { owner: 'psoldunov', repo: 'ensemblr' },
		id: overrides.id,
		pathLabel: `~/Ensemblr/workspaces/${overrides.id}`,
		pullRequest: {
			...base.pullRequest,
			gitStatus: overrides.gitStatus ?? CLEAN_GIT_STATUS,
			label: overrides.label ?? '',
			number: overrides.number,
			state: overrides.state,
			status: overrides.status ?? 'idle',
			title: overrides.title ?? '',
			url: overrides.number
				? `https://github.com/psoldunov/ensemblr/pull/${overrides.number.toString()}`
				: undefined,
		},
	};
}

/**
 * One row of the scene: the workspace that drives it plus how the resolver is
 * expected to classify it, so a row that stops matching its label is visible.
 */
export interface HeaderStateFixture {
	expectedKind: string;
	/** Why this row exists, when the kind alone does not say it. */
	note?: string;
	workspace: WorkspaceShellModel;
}

/**
 * Every state `getRightSidebarHeaderState` can return, in the order the resolver
 * checks them. `create-pr` appears twice because two different inputs reach it —
 * a workspace that never had a PR, and one whose merged PR the user continued
 * past — and only the second exercises the dismissal branch.
 */
export const HEADER_STATE_FIXTURES: readonly HeaderStateFixture[] = [
	{
		expectedKind: 'empty',
		note: 'no PR, clean branch — renders no trailing action at all',
		workspace: workspaceForState({ files: 0, id: 'playground-pr-empty' }),
	},
	{
		expectedKind: 'create-pr',
		note: 'no PR, branch has changes',
		workspace: workspaceForState({ id: 'playground-pr-create' }),
	},
	{
		expectedKind: 'pr-open',
		note: 'blank label, PR title set — no status to report renders no label at all',
		workspace: workspaceForState({
			files: 0,
			id: 'playground-pr-open',
			number: 118,
			state: 'open',
			status: 'idle',
			title: 'THE-118 Wire Linear issue flow',
		}),
	},
	{
		expectedKind: 'pr-uncommitted',
		note: 'PR open, worktree dirty — git state outranks the PR status',
		workspace: workspaceForState({
			files: 3,
			gitStatus: {
				actionLabel: 'Commit and push',
				kind: 'uncommitted',
				label: '3 uncommitted changes',
				status: 'pending',
			},
			id: 'playground-pr-uncommitted',
			label: '2 checks failing',
			number: 118,
			state: 'open',
			status: 'blocked',
		}),
	},
	{
		expectedKind: 'pr-unpushed',
		note: 'the agent committed but never pushed — direct git push, no agent',
		workspace: workspaceForState({
			files: 0,
			gitStatus: {
				actionLabel: 'Push',
				kind: 'unpushed',
				label: '2 unpushed commits',
				status: 'pending',
			},
			id: 'playground-pr-unpushed',
			number: 118,
			state: 'open',
			status: 'idle',
		}),
	},
	{
		expectedKind: 'pr-checking',
		workspace: workspaceForState({
			files: 0,
			id: 'playground-pr-checking',
			label: '1 check pending...',
			number: 118,
			state: 'open',
			status: 'checking',
		}),
	},
	{
		expectedKind: 'pr-blocked',
		workspace: workspaceForState({
			files: 0,
			id: 'playground-pr-blocked',
			label: '2 checks failing',
			number: 118,
			state: 'open',
			status: 'blocked',
		}),
	},
	{
		expectedKind: 'pr-ready',
		workspace: workspaceForState({
			files: 0,
			id: 'playground-pr-ready',
			label: 'Ready to merge',
			number: 118,
			state: 'open',
			status: 'ready-to-merge',
		}),
	},
	{
		expectedKind: 'pr-merged',
		note: 'the two-button row from the screenshot',
		workspace: workspaceForState({
			files: 0,
			id: 'playground-pr-merged',
			label: 'Merged',
			number: 15,
			state: 'merged',
			status: 'idle',
		}),
	},
	{
		expectedKind: 'create-pr',
		note: 'merged PR the user continued past — dismissal branch, same render',
		workspace: workspaceForState({
			id: CONTINUED_WORKSPACE_ID,
			label: 'Merged',
			number: 15,
			state: 'merged',
			status: 'idle',
		}),
	},
];

const PREVIEW_LABEL_COLLAPSE_WORKSPACE = workspaceForState({
	files: 0,
	id: 'playground-pr-preview-label',
	label: 'Ready to merge',
	number: 118,
	state: 'open',
	status: 'ready-to-merge',
});

/**
 * A ready-to-merge PR carrying a named preview deployment, for the row that shows
 * the pill's label collapsing. Built as its own fixture rather than picked out of
 * {@link HEADER_STATE_FIXTURES} so reordering that list cannot silently retarget
 * the row at a state with no preview pill to collapse.
 */
export const PREVIEW_LABEL_COLLAPSE_FIXTURE: HeaderStateFixture = {
	expectedKind: 'pr-ready',
	workspace: {
		...PREVIEW_LABEL_COLLAPSE_WORKSPACE,
		pullRequest: {
			...PREVIEW_LABEL_COLLAPSE_WORKSPACE.pullRequest,
			previewDeployment: NAMED_PREVIEW_DEPLOYMENT,
		},
	},
};

/** PR number the continued-merged fixture dismisses, seeded into the atom. */
export const CONTINUED_PULL_REQUEST_NUMBER = 15;

/**
 * Answers the branch-diff read the Create PR action is gated on, so each fixture
 * reports the change count it was built with. Registered on the playground
 * bridge rather than seeded into the query cache because the real query polls on
 * an interval and would overwrite a seeded value with the no-op's `undefined`.
 * @param payload - The `getWorkspaceGitStatus` request from the renderer.
 * @returns A git status result carrying that workspace's file count.
 */
export function resolveFixtureGitStatus(payload: unknown) {
	const workspaceCwd = readBridgeWorkspaceCwd(payload);
	const fixture = HEADER_STATE_FIXTURES.find(
		(candidate) => candidate.workspace.pathLabel === workspaceCwd,
	);
	const files = fixture?.workspace.changeSummary.files ?? 0;
	return { files: [], summary: { additions: 0, deletions: 0, files } };
}

/** Every tone the PR number pill and preview pill can be tinted with. */
export const HEADER_TONES = [
	'neutral',
	'pending',
	'ready',
	'blocked',
	'merged',
] as const;
