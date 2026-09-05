import { describe, expect, it, vi } from 'vitest';

import { makeReviewBriefFallback } from '../../src/main/agent-control/review-brief-fallback.ts';
import type { EnsemblrDatabaseService } from '../../src/main/storage';
import type { WorkspaceGitService } from '../../src/main/workspace-git';
import type { SettingsResolutionSnapshot } from '../../src/shared/ipc/contracts/settings-resolution.ts';
import type { WorkspaceGitFileWire } from '../../src/shared/ipc/contracts/workspace-git.ts';

/** The joined workspace row the fallback reads. */
const WORKSPACE_ROW = {
	baseBranch: 'origin/master',
	branchName: 'psoldunov/thing',
	repositoryId: 'repo-1',
	repositoryPath: '/repos/ensemblr',
};

/**
 * Builds the fallback over stubbed collaborators.
 *
 * The database is stubbed at `prepare(...).get(...)`, which is what
 * `selectWorkspaceWithRepositoryById` calls — the query text is the repository
 * module's business, and asserting it here would pin this test to its SQL.
 */
function fallback(
	options: {
		files?: WorkspaceGitFileWire[];
		preference?: string;
		row?: typeof WORKSPACE_ROW | undefined;
		connected?: boolean;
	} = {},
) {
	const getStatus = vi.fn(async () => ({
		files: options.files ?? [],
		summary: { additions: 0, deletions: 0, files: 0 },
	}));
	const resolveRepositorySettings = vi.fn(
		(): SettingsResolutionSnapshot =>
			({
				repository: {
					settings: [
						{
							key: 'actionPreferences.codeReview',
							value: options.preference ?? '',
						},
					],
				},
			}) as unknown as SettingsResolutionSnapshot,
	);
	const compose = makeReviewBriefFallback({
		databaseService: {
			getConnection: () =>
				options.connected === false
					? null
					: {
							database: {
								prepare: () => ({
									get: () =>
										options.row === undefined && 'row' in options
											? undefined
											: (options.row ?? WORKSPACE_ROW),
								}),
							},
						},
		} as unknown as EnsemblrDatabaseService,
		resolveRepositorySettings,
		workspaceGitService: { getStatus } as unknown as WorkspaceGitService,
	});
	return { compose, getStatus, resolveRepositorySettings };
}

const WORKSPACE = { workspaceCwd: '/tmp/ws', workspaceId: 'ws-1' };

describe('main-side review brief fallback', () => {
	// The base ref is stored qualified and the prompt writes its own `origin/`,
	// so a base carried through unstripped would read as `origin/origin/master`.
	it('names the branch and its base the way the Review button does', async () => {
		const { compose } = fallback();

		const brief = await compose(WORKSPACE);

		expect(brief).toContain('psoldunov/thing');
		expect(brief).toContain('origin/master');
		expect(brief).not.toContain('origin/origin/');
	});

	it('diffs against the workspace base branch', async () => {
		const { compose, getStatus } = fallback();

		await compose(WORKSPACE);

		expect(getStatus).toHaveBeenCalledWith({
			scope: { baseRef: 'origin/master', kind: 'branch' },
			workspaceCwd: '/tmp/ws',
		});
	});

	// Matches what the Changes panel shows: ignored files dropped, binary rows
	// counted as zero rather than as `null`.
	it('lists the changed files the way the panel does', async () => {
		const { compose } = fallback({
			files: [
				{
					additions: 5,
					deletions: 1,
					path: 'src/main/thing.ts',
					status: 'modified',
				},
				{ additions: null, deletions: null, path: 'logo.png', status: 'added' },
				{ additions: 0, deletions: 0, path: 'dist/out.js', status: 'ignored' },
			] as WorkspaceGitFileWire[],
		});

		const brief = await compose(WORKSPACE);

		expect(brief).toContain('- src/main/thing.ts (modified, +5/-1)');
		expect(brief).toContain('- logo.png (added, +0/-0)');
		expect(brief).not.toContain('dist/out.js');
	});

	// The repository's committed `[prompts]` preference is the one review input
	// main *can* see, so losing it here would make the fallback weaker than it
	// needs to be.
	it('carries the repository’s committed review preference', async () => {
		const { compose } = fallback({
			preference: 'Only flag security findings.',
		});

		const brief = await compose(WORKSPACE);

		expect(brief).toContain('Only flag security findings.');
		expect(brief).toContain("The following are the user's custom preferences");
	});

	it('composes a usable brief when the workspace row cannot be read', async () => {
		const { compose, resolveRepositorySettings } = fallback({ row: undefined });

		const brief = await compose(WORKSPACE);

		expect(brief).toContain('origin/the base branch');
		expect(brief).toContain('this branch');
		expect(resolveRepositorySettings).not.toHaveBeenCalled();
	});

	it('composes a usable brief when the database is not connected', async () => {
		const { compose } = fallback({ connected: false });

		await expect(compose(WORKSPACE)).resolves.toContain('# Review guidelines');
	});
});
