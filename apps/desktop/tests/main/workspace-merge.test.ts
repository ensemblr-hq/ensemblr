import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LocalCommandService } from '../../src/main/commands/local-command';
import {
	createLocalBaseSync,
	type MergeCloseOutService,
	mergeWorkspacePullRequest,
} from '../../src/main/merge-close-out';
import type { EnsemblrDatabaseService } from '../../src/main/storage';
import type { SettingsResolutionSnapshot } from '../../src/shared/ipc/contracts/settings-resolution.ts';
import type { LocalBaseSyncOutcome } from '../../src/shared/workspace-merge.ts';

const fastForwardLocalBase = vi.hoisted(() =>
	vi.fn(
		async (): Promise<LocalBaseSyncOutcome> => ({
			branch: 'master',
			status: 'up-to-date',
		}),
	),
);

vi.mock('../../src/main/repository/base-fast-forward.ts', () => ({
	fastForwardLocalBase,
}));

const REQUEST = { workspaceCwd: '/ws/bach', workspaceId: 'ws-1' };
const BASE_SYNC: LocalBaseSyncOutcome = {
	branch: 'master',
	from: 'aaa',
	status: 'fast-forwarded',
	to: 'bbb',
};

afterEach(() => {
	vi.clearAllMocks();
});

function closeOutService(): MergeCloseOutService & {
	closeOut: ReturnType<typeof vi.fn>;
} {
	return {
		closeOut: vi.fn(async (event) => ({
			...event,
			baseSync: BASE_SYNC,
			issue: { status: 'closed' as const },
		})),
	};
}

describe('mergeWorkspacePullRequest', () => {
	it('joins the close-out the merge set off and reports it', async () => {
		const mergeCloseOutService = closeOutService();
		const mergePullRequest = vi.fn(async () => ({
			merged: true,
			pullRequestNumber: 7,
		}));

		const outcome = await mergeWorkspacePullRequest(
			{ githubService: { mergePullRequest }, mergeCloseOutService },
			{ ...REQUEST, method: 'rebase' },
		);

		expect(mergePullRequest).toHaveBeenCalledWith({
			...REQUEST,
			method: 'rebase',
		});
		expect(mergeCloseOutService.closeOut).toHaveBeenCalledWith({
			pullRequestNumber: 7,
			workspaceId: 'ws-1',
		});
		expect(outcome).toEqual({
			baseSync: BASE_SYNC,
			issue: 'closed',
			pullRequestNumber: 7,
			status: 'merged',
		});
	});

	it('reports a merge a queue took without closing anything out', async () => {
		const mergeCloseOutService = closeOutService();

		const outcome = await mergeWorkspacePullRequest(
			{
				githubService: {
					mergePullRequest: async () => ({
						merged: true,
						pullRequestNumber: null,
					}),
				},
				mergeCloseOutService,
			},
			REQUEST,
		);

		expect(outcome).toEqual({ status: 'queued' });
		expect(mergeCloseOutService.closeOut).not.toHaveBeenCalled();
	});

	it('passes a failed merge back with its failure', async () => {
		const failure = {
			code: 'merge-blocked' as const,
			message: 'Required checks have not passed.',
		};

		const outcome = await mergeWorkspacePullRequest(
			{
				githubService: {
					mergePullRequest: async () => ({ error: failure, merged: false }),
				},
				mergeCloseOutService: closeOutService(),
			},
			REQUEST,
		);

		expect(outcome).toEqual({ failure, status: 'failed' });
	});
});

function databaseWith(row: unknown): EnsemblrDatabaseService {
	return {
		getConnection: () => ({
			database: { prepare: () => ({ get: () => row }) },
		}),
	} as unknown as EnsemblrDatabaseService;
}

function settingsWith(value: unknown): () => SettingsResolutionSnapshot {
	return () => ({
		app: { diagnostics: [], settings: [] },
		repository: {
			diagnostics: [],
			settings:
				value === undefined
					? []
					: [
							{
								candidates: [],
								key: 'updateBaseAfterMerge',
								locked: false,
								source: 'user-default',
								value,
							},
						],
		},
	});
}

const WORKSPACE_ROW = {
	baseBranch: 'origin/master',
	repositoryId: 'repo-1',
	repositoryPath: '/repos/app',
};
const commands = {} as LocalCommandService;

describe('createLocalBaseSync', () => {
	it('fast-forwards the base of the merged workspace in its repository root', async () => {
		const resolveRepositorySettings = vi.fn(settingsWith(true));
		const sync = createLocalBaseSync({
			databaseService: databaseWith(WORKSPACE_ROW),
			localCommandService: commands,
			resolveRepositorySettings,
		});

		const outcome = await sync('ws-1');

		expect(resolveRepositorySettings).toHaveBeenCalledWith({
			repositoryId: 'repo-1',
			repositoryPath: '/repos/app',
		});
		expect(fastForwardLocalBase).toHaveBeenCalledWith({
			baseBranch: 'origin/master',
			localCommandService: commands,
			repositoryPath: '/repos/app',
		});
		expect(outcome).toEqual({ branch: 'master', status: 'up-to-date' });
	});

	it('treats a setting it cannot find as on', async () => {
		const sync = createLocalBaseSync({
			databaseService: databaseWith(WORKSPACE_ROW),
			localCommandService: commands,
			resolveRepositorySettings: settingsWith(undefined),
		});

		await sync('ws-1');

		expect(fastForwardLocalBase).toHaveBeenCalledOnce();
	});

	it('leaves the base alone when the repository turned the setting off', async () => {
		const sync = createLocalBaseSync({
			databaseService: databaseWith(WORKSPACE_ROW),
			localCommandService: commands,
			resolveRepositorySettings: settingsWith(false),
		});

		const outcome = await sync('ws-1');

		expect(outcome).toEqual({ status: 'disabled' });
		expect(fastForwardLocalBase).not.toHaveBeenCalled();
	});

	it('runs one fast-forward at a time in the same repository', async () => {
		let releaseFirst: (outcome: LocalBaseSyncOutcome) => void = () => undefined;
		fastForwardLocalBase.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseFirst = resolve;
				}),
		);
		const sync = createLocalBaseSync({
			databaseService: databaseWith(WORKSPACE_ROW),
			localCommandService: commands,
			resolveRepositorySettings: settingsWith(true),
		});

		const first = sync('ws-1');
		const second = sync('ws-2');
		await vi.waitFor(() => expect(fastForwardLocalBase).toHaveBeenCalledOnce());
		await Promise.resolve();
		expect(fastForwardLocalBase).toHaveBeenCalledOnce();

		releaseFirst(BASE_SYNC);

		expect(await first).toEqual(BASE_SYNC);
		expect(await second).toEqual({ branch: 'master', status: 'up-to-date' });
		expect(fastForwardLocalBase).toHaveBeenCalledTimes(2);
	});

	it('reports a workspace with no base branch on record', async () => {
		const sync = createLocalBaseSync({
			databaseService: databaseWith({ ...WORKSPACE_ROW, baseBranch: null }),
			localCommandService: commands,
			resolveRepositorySettings: settingsWith(true),
		});

		const outcome = await sync('ws-1');

		expect(outcome.status).toBe('unavailable');
		expect(fastForwardLocalBase).not.toHaveBeenCalled();
	});
});
