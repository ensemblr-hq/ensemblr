import path from 'node:path';

import type {
	CommitWorkspaceChangesRequest,
	CommitWorkspaceChangesResult,
	CreatePullRequestRequest,
	CreatePullRequestResult,
	GetPullRequestSnapshotRequest,
	GetPullRequestSnapshotResult,
	GitBranchSyncWire,
	GithubFailure,
	GithubPullRequestSnapshotWire,
	MergePullRequestRequest,
	MergePullRequestResult,
	PushWorkspaceBranchRequest,
	PushWorkspaceBranchResult,
} from '../../shared/ipc';
import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import type { EnsembleDatabaseService } from '../storage';
import { classifyCommandFailure } from './gh-failures.ts';
import {
	readCachedPullRequestSnapshot,
	writeCachedPullRequestSnapshot,
} from './pr-cache.ts';
import {
	PR_VIEW_JSON_FIELDS,
	parseDeployments,
	parsePullRequestView,
	parseReviewThreads,
} from './pr-snapshot.ts';

const GIT_TIMEOUT_MS = 30_000;
const GH_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** Cache freshness window before a non-forced snapshot read re-runs `gh`. */
const SNAPSHOT_TTL_MS = 30_000;

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 50) {
        nodes {
          isResolved
          comments(first: 1) {
            nodes { id body createdAt path line url author { login } }
          }
        }
      }
    }
  }
}`;

export interface GithubService {
	commitWorkspaceChanges: (
		request: CommitWorkspaceChangesRequest,
	) => Promise<CommitWorkspaceChangesResult>;
	createPullRequest: (
		request: CreatePullRequestRequest,
	) => Promise<CreatePullRequestResult>;
	getPullRequestSnapshot: (
		request: GetPullRequestSnapshotRequest,
	) => Promise<GetPullRequestSnapshotResult>;
	mergePullRequest: (
		request: MergePullRequestRequest,
	) => Promise<MergePullRequestResult>;
	pushWorkspaceBranch: (
		request: PushWorkspaceBranchRequest,
	) => Promise<PushWorkspaceBranchResult>;
}

export interface CreateGithubServiceOptions {
	databaseService: EnsembleDatabaseService;
	localCommandService: LocalCommandService;
	now?: () => Date;
}

/**
 * Single command boundary for git review-flow operations and all `gh`/`gh api`
 * calls (ADR 0013). Never adds an app-owned GitHub OAuth client; everything
 * rides on the user's existing `gh` authentication.
 */
export function createGithubService({
	databaseService,
	localCommandService,
	now = () => new Date(),
}: CreateGithubServiceOptions): GithubService {
	async function run(
		command: 'gh' | 'git',
		cwd: string,
		args: readonly string[],
	): Promise<LocalCommandResult> {
		return localCommandService.run({
			args: [...args],
			command,
			cwd,
			maxOutputBytes: MAX_OUTPUT_BYTES,
			timeoutMs: command === 'gh' ? GH_TIMEOUT_MS : GIT_TIMEOUT_MS,
		});
	}

	/** Reads ahead/behind state for the workspace branch versus its upstream. */
	async function readBranchSync(
		cwd: string,
	): Promise<GitBranchSyncWire | null> {
		const branchResult = await run('git', cwd, [
			'rev-parse',
			'--abbrev-ref',
			'HEAD',
		]);
		if (branchResult.status !== 'success') {
			return null;
		}
		const branchName = branchResult.stdout.trim();
		const countResult = await run('git', cwd, [
			'rev-list',
			'--left-right',
			'--count',
			'@{upstream}...HEAD',
		]);
		if (countResult.status !== 'success') {
			return { ahead: 0, behind: 0, branchName, hasUpstream: false };
		}
		const [behind = '0', ahead = '0'] = countResult.stdout.trim().split(/\s+/);
		return {
			ahead: Number.parseInt(ahead, 10) || 0,
			behind: Number.parseInt(behind, 10) || 0,
			branchName,
			hasUpstream: true,
		};
	}

	/** Fetches the live PR snapshot from `gh`, enriching with deployments/threads. */
	async function fetchSnapshot(
		cwd: string,
	): Promise<
		| { ok: true; snapshot: GithubPullRequestSnapshotWire }
		| { error: GithubFailure; noPullRequest: boolean; ok: false }
	> {
		const branchSync = await readBranchSync(cwd);
		const viewResult = await run('gh', cwd, [
			'pr',
			'view',
			'--json',
			PR_VIEW_JSON_FIELDS,
		]);
		if (viewResult.status !== 'success') {
			const failure = classifyCommandFailure(
				viewResult,
				'gh pr view failed in workspace.',
			);
			if (failure.code === 'no-pull-request') {
				return {
					ok: true,
					snapshot: {
						branchSync,
						pullRequest: null,
						syncedAt: now().toISOString(),
					},
				};
			}
			return { error: failure, noPullRequest: false, ok: false };
		}

		let pullRequest: ReturnType<typeof parsePullRequestView>;
		try {
			pullRequest = parsePullRequestView(viewResult.stdout);
		} catch (cause) {
			return {
				error: {
					code: 'parse-failed',
					message:
						cause instanceof Error
							? `Could not parse gh pr view output: ${cause.message}`
							: 'Could not parse gh pr view output.',
				},
				noPullRequest: false,
				ok: false,
			};
		}

		const [deployments, reviewThreads] = await Promise.all([
			fetchDeployments(cwd, pullRequest.headRefName),
			fetchReviewThreads(cwd, pullRequest.number),
		]);

		return {
			ok: true,
			snapshot: {
				branchSync,
				pullRequest: {
					...pullRequest,
					comments: [...pullRequest.comments, ...reviewThreads],
					deployments,
				},
				syncedAt: now().toISOString(),
			},
		};
	}

	/**
	 * Reads deployment + latest-status rows for the branch through authenticated
	 * `gh api`. GET calls pass query fields, so `-X GET` stays explicit per
	 * ENS-055/ENS-056. Failures degrade to an empty list — preview links are
	 * best-effort.
	 */
	async function fetchDeployments(cwd: string, branch: string) {
		const deploymentsResult = await run('gh', cwd, [
			'api',
			'-X',
			'GET',
			'repos/{owner}/{repo}/deployments',
			'-f',
			`ref=${branch}`,
			'-f',
			'per_page=5',
		]);
		if (deploymentsResult.status !== 'success') {
			return [];
		}
		let deployments: unknown;
		try {
			deployments = JSON.parse(deploymentsResult.stdout);
		} catch {
			return [];
		}
		if (!Array.isArray(deployments) || deployments.length === 0) {
			return [];
		}

		const statuses = new Map<string, unknown>();
		await Promise.all(
			deployments.slice(0, 3).map(async (deployment) => {
				const id = String(
					(deployment as Record<string, unknown> | null)?.id ?? '',
				);
				if (!id) {
					return;
				}
				const statusResult = await run('gh', cwd, [
					'api',
					'-X',
					'GET',
					`repos/{owner}/{repo}/deployments/${id}/statuses`,
					'-f',
					'per_page=1',
				]);
				if (statusResult.status !== 'success') {
					return;
				}
				try {
					const parsed = JSON.parse(statusResult.stdout) as unknown[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						statuses.set(id, parsed[0]);
					}
				} catch {
					// Status row stays absent; deployment renders without a URL.
				}
			}),
		);
		return parseDeployments(deployments, statuses);
	}

	/** Reads review-thread resolution state through `gh api graphql`. */
	async function fetchReviewThreads(cwd: string, prNumber: number) {
		if (!prNumber) {
			return [];
		}
		const result = await run('gh', cwd, [
			'api',
			'graphql',
			'-F',
			'owner={owner}',
			'-F',
			'name={repo}',
			'-F',
			`number=${prNumber}`,
			'-f',
			`query=${REVIEW_THREADS_QUERY}`,
		]);
		if (result.status !== 'success') {
			return [];
		}
		try {
			const parsed = JSON.parse(result.stdout) as {
				data?: {
					repository?: { pullRequest?: { reviewThreads?: unknown } };
				};
			};
			return parseReviewThreads(
				parsed.data?.repository?.pullRequest?.reviewThreads,
			);
		} catch {
			return [];
		}
	}

	return {
		async commitWorkspaceChanges(request) {
			const cwd = validateCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return { error: cwd.error, ok: false };
			}
			const message = request.message.trim();
			if (!message) {
				return {
					error: {
						code: 'command-failed',
						message: 'Commit message must not be empty.',
					},
					ok: false,
				};
			}

			const stageArgs = request.paths?.length
				? ['add', '--', ...request.paths]
				: ['add', '--all'];
			const stageResult = await run('git', cwd.cwd, stageArgs);
			if (stageResult.status !== 'success') {
				return {
					error: classifyCommandFailure(stageResult, 'git add failed.'),
					ok: false,
				};
			}

			const commitResult = await run('git', cwd.cwd, ['commit', '-m', message]);
			if (commitResult.status !== 'success') {
				const stdout = commitResult.stdout.toLowerCase();
				if (stdout.includes('nothing to commit')) {
					return {
						error: {
							code: 'nothing-to-commit',
							message: 'Nothing to commit — the working tree is clean.',
						},
						ok: false,
					};
				}
				return {
					error: classifyCommandFailure(commitResult, 'git commit failed.'),
					ok: false,
				};
			}

			const hashResult = await run('git', cwd.cwd, ['rev-parse', 'HEAD']);
			return {
				...(hashResult.status === 'success'
					? { commitHash: hashResult.stdout.trim() }
					: {}),
				ok: true,
			};
		},

		async pushWorkspaceBranch(request) {
			const cwd = validateCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return { error: cwd.error, ok: false };
			}
			const pushResult = await run('git', cwd.cwd, [
				'push',
				'--set-upstream',
				'origin',
				'HEAD',
			]);
			if (pushResult.status !== 'success') {
				return {
					error: classifyCommandFailure(pushResult, 'git push failed.'),
					ok: false,
				};
			}
			return { ok: true };
		},

		async createPullRequest(request) {
			const cwd = validateCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return { error: cwd.error, ok: false };
			}
			const title = request.title.trim();
			if (!title) {
				return {
					error: {
						code: 'command-failed',
						message: 'Pull request title must not be empty.',
					},
					ok: false,
				};
			}

			const args = [
				'pr',
				'create',
				'--title',
				title,
				'--body',
				request.body,
				...(request.baseBranch ? ['--base', request.baseBranch] : []),
				...(request.draft ? ['--draft'] : []),
			];
			const createResult = await run('gh', cwd.cwd, args);
			if (createResult.status !== 'success') {
				return {
					error: classifyCommandFailure(createResult, 'gh pr create failed.'),
					ok: false,
				};
			}

			const url = extractPullRequestUrl(createResult.stdout);
			const number = url ? extractPullRequestNumber(url) : undefined;
			return {
				ok: true,
				...(number ? { pullRequestNumber: number } : {}),
				...(url ? { pullRequestUrl: url } : {}),
			};
		},

		async getPullRequestSnapshot(request) {
			const cwd = validateCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return { error: cwd.error, fromCache: false, snapshot: null };
			}
			const database = databaseService.getConnection()?.database ?? null;
			const cached = database
				? readCachedPullRequestSnapshot({
						database,
						workspaceId: request.workspaceId,
					})
				: null;

			if (!request.refresh && cached && isFresh(cached.syncedAt, now())) {
				return { fromCache: true, snapshot: cached };
			}

			const fetched = await fetchSnapshot(cwd.cwd);
			if (!fetched.ok) {
				// gh failed: keep the panel alive with the last known snapshot, but
				// surface the refresh error instead of hiding it (ENS-055).
				return {
					error: fetched.error,
					fromCache: cached !== null,
					snapshot: cached,
				};
			}

			if (database) {
				writeCachedPullRequestSnapshot({
					database,
					snapshot: fetched.snapshot,
					workspaceId: request.workspaceId,
				});
			}
			return { fromCache: false, snapshot: fetched.snapshot };
		},

		async mergePullRequest(request) {
			const cwd = validateCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return { error: cwd.error, merged: false };
			}
			const method = request.method ?? 'squash';
			const mergeResult = await run('gh', cwd.cwd, [
				'pr',
				'merge',
				`--${method}`,
			]);
			if (mergeResult.status !== 'success') {
				return {
					error: classifyCommandFailure(mergeResult, 'gh pr merge failed.'),
					merged: false,
				};
			}
			// Refresh the cache so the workspace immediately reflects merged state.
			const database = databaseService.getConnection()?.database ?? null;
			if (database) {
				const refreshed = await fetchSnapshot(cwd.cwd);
				if (refreshed.ok) {
					writeCachedPullRequestSnapshot({
						database,
						snapshot: refreshed.snapshot,
						workspaceId: request.workspaceId,
					});
				}
			}
			return { merged: true };
		},
	};

	function isFresh(syncedAt: string, current: Date): boolean {
		const parsed = Date.parse(syncedAt);
		return (
			Number.isFinite(parsed) && current.getTime() - parsed < SNAPSHOT_TTL_MS
		);
	}
}

/** Validates the renderer-supplied workspace cwd. */
function validateCwd(
	workspaceCwd: string,
): { cwd: string; ok: true } | { error: GithubFailure; ok: false } {
	const cwd = workspaceCwd?.trim();
	if (!cwd || !path.isAbsolute(cwd)) {
		return {
			error: {
				code: 'invalid-cwd',
				message: 'Workspace path must be an absolute filesystem path.',
			},
			ok: false,
		};
	}
	return { cwd, ok: true };
}

/** Finds the created PR URL in `gh pr create` stdout. */
export function extractPullRequestUrl(stdout: string): string | undefined {
	const match = stdout.match(/https:\/\/[^\s]+\/pull\/\d+/);
	return match?.[0];
}

/** Extracts the PR number from a GitHub PR URL. */
export function extractPullRequestNumber(url: string): number | undefined {
	const match = url.match(/\/pull\/(\d+)/);
	const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : undefined;
}
