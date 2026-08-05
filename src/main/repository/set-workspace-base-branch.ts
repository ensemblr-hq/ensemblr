import type {
	SetWorkspaceBaseBranchDiagnostic,
	SetWorkspaceBaseBranchRequest,
	SetWorkspaceBaseBranchResult,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrDatabaseService } from '../storage';
import {
	selectWorkspaceWithRepositoryById,
	updateWorkspaceBaseBranchRow,
} from '../storage/repositories/workspace-repository.ts';
import { ensureBaseRefAvailable } from './create-workspace.ts';
import { validateGitRef } from './validate-git-ref.ts';

/** Public surface of the workspace base-branch retargeting service. */
export interface SetWorkspaceBaseBranchService {
	setBaseBranch: (
		request: SetWorkspaceBaseBranchRequest,
	) => Promise<SetWorkspaceBaseBranchResult>;
}

/** Options for {@link createSetWorkspaceBaseBranchService}. */
export interface CreateSetWorkspaceBaseBranchServiceOptions {
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
	now?: () => Date;
}

const GIT_VERIFY_TIMEOUT_MS = 10_000;
const GIT_VERIFY_MAX_OUTPUT_BYTES = 4 * 1024;

/** Internal: the workspace row fields this service reads. */
interface TargetWorkspace {
	baseBranch: string | null;
	id: string;
	repositoryPath: string;
}

/**
 * Builds the service that retargets which branch a workspace reviews and opens
 * pull requests against.
 *
 * The worktree is never touched: its fork point is history, and rewriting it
 * would discard work. Only `workspaces.base_branch` moves, which re-scopes the
 * merge-base used for diffs, the conflict probe, and the PR target.
 * @param options - Service dependencies.
 * @returns A {@link SetWorkspaceBaseBranchService}.
 */
export function createSetWorkspaceBaseBranchService({
	databaseService,
	localCommandService,
	now = () => new Date(),
}: CreateSetWorkspaceBaseBranchServiceOptions): SetWorkspaceBaseBranchService {
	return {
		setBaseBranch: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure({
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the target branch was not changed.',
					severity: 'error',
				});
			}

			const baseBranch = normalizeRef(request.baseBranch);
			const invalidRef = validateBranchRef(baseBranch);
			if (invalidRef) {
				return failure(invalidRef);
			}

			const workspace = readWorkspace(
				selectWorkspaceWithRepositoryById({
					database,
					workspaceId: normalizeRef(request.workspaceId),
				}),
			);
			if (!workspace) {
				return failure({
					code: 'workspace-not-found',
					message: 'That workspace no longer exists.',
					severity: 'error',
				});
			}

			if (workspace.baseBranch === baseBranch) {
				return { baseBranch, diagnostics: [], status: 'success' };
			}

			await ensureBaseRefAvailable({
				baseBranch,
				localCommandService,
				repositoryPath: workspace.repositoryPath,
			});

			const resolves = await branchRefResolves({
				baseBranch,
				localCommandService,
				repositoryPath: workspace.repositoryPath,
			});
			if (!resolves) {
				return failure({
					code: 'base-branch-unresolvable',
					message: `Could not resolve "${baseBranch}" in this repository, even after fetching. The target branch was not changed.`,
					severity: 'error',
				});
			}

			updateWorkspaceBaseBranchRow({
				baseBranch,
				database,
				id: workspace.id,
				timestamp: now().toISOString(),
			});

			return { baseBranch, diagnostics: [], status: 'success' };
		},
	};
}

/**
 * Verifies a ref names a commit in the repository, mirroring the guard
 * `create-workspace` applies to a configured `branchFrom`.
 * @param options - The ref to verify plus the repository to verify it in.
 * @returns True when the ref resolves to a commit.
 */
async function branchRefResolves({
	baseBranch,
	localCommandService,
	repositoryPath,
}: {
	baseBranch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<boolean> {
	try {
		const result = await localCommandService.run({
			args: ['rev-parse', '--verify', '--quiet', `${baseBranch}^{commit}`],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: GIT_VERIFY_MAX_OUTPUT_BYTES,
			timeoutMs: GIT_VERIFY_TIMEOUT_MS,
		});
		return result.status === 'success';
	} catch {
		return false;
	}
}

/**
 * Maps a shared ref rejection onto this service's diagnostic shape, swapping in
 * picker-appropriate wording for a ref the user never chose.
 * @param ref - The candidate branch ref.
 * @returns A diagnostic when the ref is unusable, otherwise null.
 */
function validateBranchRef(
	ref: string,
): SetWorkspaceBaseBranchDiagnostic | null {
	const rejection = validateGitRef(ref);
	if (!rejection) {
		return null;
	}
	return {
		code: 'base-branch-invalid',
		message:
			rejection.reason === 'empty'
				? 'Pick a target branch.'
				: rejection.message,
		severity: 'error',
	};
}

/**
 * Narrows a raw joined workspace row to the fields this service needs.
 * @param row - Raw row from {@link selectWorkspaceWithRepositoryById}.
 * @returns The narrowed workspace, or null when the row is absent or malformed.
 */
function readWorkspace(row: unknown): TargetWorkspace | null {
	if (!row || typeof row !== 'object') {
		return null;
	}
	const candidate = row as Record<string, unknown>;
	if (
		typeof candidate.id !== 'string' ||
		typeof candidate.repositoryPath !== 'string'
	) {
		return null;
	}
	return {
		baseBranch:
			typeof candidate.baseBranch === 'string' ? candidate.baseBranch : null,
		id: candidate.id,
		repositoryPath: candidate.repositoryPath,
	};
}

/**
 * Trims an untrusted string field, tolerating non-string IPC payloads.
 * @param value - The raw field value.
 * @returns The trimmed string, or `''` when the value is not a string.
 */
function normalizeRef(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/**
 * Wraps a single diagnostic in a failed result.
 * @param diagnostic - The problem to report.
 * @returns A failure result carrying the diagnostic.
 */
function failure(
	diagnostic: SetWorkspaceBaseBranchDiagnostic,
): SetWorkspaceBaseBranchResult {
	return { baseBranch: null, diagnostics: [diagnostic], status: 'failure' };
}
