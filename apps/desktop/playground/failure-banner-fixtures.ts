import { getDefaultWorkspace } from '@/renderer/fixtures/workbench';
import type {
	CommandFailureCopy,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { GithubFailure } from '@/shared/ipc/contracts/github';
import type { WorkspaceGitFailure } from '@/shared/ipc/contracts/workspace-git';

/**
 * The gh refresh failures worth reading against each other: ones whose code
 * carries the whole explanation, ones whose code says nothing and lean entirely
 * on stderr, one whose stderr only repeats the explanation, and one that wrote
 * no stderr at all. `output` is verbatim `gh` and `git` text where it exists,
 * and absent where the command printed nothing — which is what the banner has
 * to tell apart, since `message` is main's own English either way.
 */
export const SYNC_FAILURES: readonly {
	failure: GithubFailure;
	label: string;
}[] = [
	{
		failure: {
			code: 'detached-head',
			message:
				'could not determine current branch: failed to run git: not on any branch',
			output:
				'could not determine current branch: failed to run git: not on any branch',
		},
		label: 'detached-head',
	},
	{
		failure: {
			code: 'command-failed',
			message:
				'fatal: unable to access https://github.com/example/florence.git/: Could not resolve host: github.com',
			output:
				'fatal: unable to access https://github.com/example/florence.git/: Could not resolve host: github.com',
		},
		label: 'command-failed',
	},
	{
		failure: {
			code: 'gh-not-authenticated',
			message:
				'gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.',
			output:
				'gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.',
		},
		label: 'gh-not-authenticated',
	},
	{
		failure: {
			code: 'no-remote',
			message: "fatal: 'origin' does not appear to be a git repository",
			output: "fatal: 'origin' does not appear to be a git repository",
		},
		label: 'no-remote',
	},
	{
		failure: {
			code: 'gh-not-installed',
			message: 'gh: command not found',
			output: 'gh: command not found',
		},
		label: 'gh-not-installed',
	},
	{
		failure: {
			code: 'parse-failed',
			message: 'The command output could not be parsed.',
			output: 'The command output could not be parsed.',
		},
		label: 'output repeats copy',
	},
	{
		failure: {
			code: 'command-failed',
			message: 'gh pr view failed in workspace.',
		},
		label: 'no stderr',
	},
];

/** The trial-merge failure the Conflicts section reports through the same banner. */
export const MERGE_PROBE_FAILURE: WorkspaceGitFailure = {
	code: 'command-failed',
	message:
		'error: Your local changes to the following files would be overwritten by merge:\n\tsrc/renderer/components/workbench-shell/panel-alert.tsx',
	output:
		'error: Your local changes to the following files would be overwritten by merge:\n\tsrc/renderer/components/workbench-shell/panel-alert.tsx',
};

/**
 * A workspace whose last gh refresh failed, so the Checks panel leads with the
 * sync banner above content that still works.
 * @param syncError - The banner copy the failure was translated into.
 * @returns The workspace shell model the Checks panel renders.
 */
export function unsyncedWorkspace(
	syncError: CommandFailureCopy,
): WorkspaceShellModel {
	const workspace = getDefaultWorkspace();
	return {
		...workspace,
		pullRequest: {
			...workspace.pullRequest,
			checks: [],
			comments: [],
			description: [],
			label: 'No PR',
			status: 'idle',
			syncError,
			todos: [],
		},
	};
}
