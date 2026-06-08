import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ArchivedRepositorySnapshot,
	ArchiveRepositoryDiagnostic,
	ArchiveRepositoryDiagnosticCode,
	ArchiveRepositoryRequest,
	ArchiveRepositoryResult,
} from '../../shared/ipc';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import { ARCHIVED_REPOSITORY_MARKER } from './archived-marker.ts';
import { firstLine } from './first-line.ts';
/** Public surface of the repository archive service. */
export interface ArchiveRepositoryService {
	archive: (
		request: ArchiveRepositoryRequest,
	) => Promise<ArchiveRepositoryResult>;
}

/** Options for {@link createArchiveRepositoryService}. */
export interface CreateArchiveRepositoryServiceOptions {
	databaseService: EnsembleDatabaseService;
	localCommandService: LocalCommandService;
}

/** Internal: repository row enriched with the child workspaces we need to clean. */
interface SourceRepository {
	id: string;
	name: string;
	path: string;
	workspaces: SourceWorkspace[];
}

interface SourceWorkspace {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
}

const GIT_WORKTREE_TIMEOUT_MS = 15_000;
const GIT_BRANCH_TIMEOUT_MS = 5_000;

/**
 * Builds the service that archives a repository: every child workspace is
 * destructively cleaned (worktree removed, branch dropped), workspace rows and
 * the repository row are wiped from SQLite, but the repository's own folder on
 * disk is left intact so re-adopting it later is just a re-register.
 * @param options - Service dependencies.
 * @returns An {@link ArchiveRepositoryService}.
 */
export function createArchiveRepositoryService({
	databaseService,
	localCommandService,
}: CreateArchiveRepositoryServiceOptions): ArchiveRepositoryService {
	return {
		archive: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure({
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the repository was not archived.',
					severity: 'error',
				});
			}

			const repositoryId =
				typeof request.repositoryId === 'string'
					? request.repositoryId.trim()
					: '';
			if (!repositoryId) {
				return failure({
					code: 'repository-id-required',
					message: 'A repository id is required to archive a repository.',
					severity: 'error',
				});
			}

			const source = readRepository(database, repositoryId);
			if (!source) {
				return failure({
					code: 'repository-not-found',
					message: `No repository is registered with id ${repositoryId}.`,
					severity: 'error',
				});
			}

			const diagnostics: ArchiveRepositoryDiagnostic[] = [];

			for (const workspace of source.workspaces) {
				await runWorktreeRemove({
					diagnostics,
					localCommandService,
					repositoryPath: source.path,
					workspace,
				});

				removeWorkspaceDirectory({
					diagnostics,
					workspace,
				});

				if (workspace.branchName) {
					await runBranchDelete({
						branchName: workspace.branchName,
						diagnostics,
						localCommandService,
						repositoryPath: source.path,
						workspaceId: workspace.id,
					});
				}
			}

			try {
				deleteRepositoryRows({ database, repositoryId: source.id });
			} catch (error) {
				diagnostics.push({
					code: 'repository-delete-failed',
					message:
						error instanceof Error
							? error.message
							: 'Failed to delete the repository row.',
					severity: 'error',
				});
				return {
					diagnostics,
					repository: null,
					status: 'failure',
					workspacesArchived: 0,
				};
			}

			writeArchivedMarker({ diagnostics, repositoryPath: source.path });

			const repository: ArchivedRepositorySnapshot = {
				archivedWorkspaceIds: source.workspaces.map((w) => w.id),
				id: source.id,
				name: source.name,
				path: source.path,
			};

			return {
				diagnostics,
				repository,
				status: 'success',
				workspacesArchived: source.workspaces.length,
			};
		},
	};
}

/**
 * Reads the repository row and its child workspaces. Returns `null` when the
 * repository cannot be resolved.
 */
function readRepository(
	database: DatabaseSync,
	repositoryId: string,
): SourceRepository | null {
	const repositoryRow = database
		.prepare(
			`SELECT id AS id, name AS name, path AS path
			FROM repositories
			WHERE id = ?`,
		)
		.get(repositoryId);

	if (!isRepositoryRow(repositoryRow)) {
		return null;
	}

	const workspaceRows = database
		.prepare(
			`SELECT
				id AS id,
				name AS name,
				path AS path,
				branch_name AS branchName
			FROM workspaces
			WHERE repository_id = ?`,
		)
		.all(repositoryId);

	const workspaces: SourceWorkspace[] = [];
	for (const row of workspaceRows) {
		if (isWorkspaceRow(row)) {
			workspaces.push(row);
		}
	}

	return {
		id: repositoryRow.id,
		name: repositoryRow.name,
		path: repositoryRow.path,
		workspaces,
	};
}

/**
 * Runs `git worktree remove --force <path>` inside the source repository.
 * Surfaces a warning on failure; cleanup continues regardless.
 */
async function runWorktreeRemove({
	diagnostics,
	localCommandService,
	repositoryPath,
	workspace,
}: {
	diagnostics: ArchiveRepositoryDiagnostic[];
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspace: SourceWorkspace;
}): Promise<void> {
	try {
		const result = await localCommandService.run({
			args: ['worktree', 'remove', '--force', workspace.path],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 16 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});

		if (result.status === 'success') {
			return;
		}

		diagnostics.push({
			code: 'workspace-cleanup-failed',
			message:
				firstLine(result.stderr) ||
				`git worktree remove --force exited with status ${result.status}.`,
			path: workspace.path,
			severity: 'warning',
			workspaceId: workspace.id,
		});
	} catch (error) {
		diagnostics.push({
			code: 'workspace-cleanup-failed',
			message:
				error instanceof Error
					? error.message
					: 'git worktree remove --force threw unexpectedly.',
			path: workspace.path,
			severity: 'warning',
			workspaceId: workspace.id,
		});
	}
}

/**
 * Removes the workspace directory from disk. Warns on failure; not fatal.
 */
function removeWorkspaceDirectory({
	diagnostics,
	workspace,
}: {
	diagnostics: ArchiveRepositoryDiagnostic[];
	workspace: SourceWorkspace;
}): void {
	try {
		rmSync(workspace.path, { force: true, recursive: true });
	} catch (error) {
		if (existsSync(workspace.path)) {
			diagnostics.push({
				code: 'workspace-cleanup-failed',
				message:
					error instanceof Error
						? error.message
						: 'Failed to remove the workspace directory.',
				path: workspace.path,
				severity: 'warning',
				workspaceId: workspace.id,
			});
		}
	}
}

/**
 * Runs `git branch -D <branch>` inside the source repository. Warns on
 * failure — losing a stray local branch is not a hard error.
 */
async function runBranchDelete({
	branchName,
	diagnostics,
	localCommandService,
	repositoryPath,
	workspaceId,
}: {
	branchName: string;
	diagnostics: ArchiveRepositoryDiagnostic[];
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspaceId: string;
}): Promise<void> {
	try {
		const result = await localCommandService.run({
			args: ['branch', '-D', branchName],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 16 * 1024,
			timeoutMs: GIT_BRANCH_TIMEOUT_MS,
		});

		if (result.status === 'success') {
			return;
		}

		const stderr = result.stderr || '';
		if (stderr.includes('not found') || stderr.includes('No such branch')) {
			return;
		}

		diagnostics.push({
			code: 'workspace-cleanup-failed',
			message: firstLine(stderr) || 'git branch -D failed.',
			severity: 'warning',
			workspaceId,
		});
	} catch (error) {
		diagnostics.push({
			code: 'workspace-cleanup-failed',
			message:
				error instanceof Error
					? error.message
					: 'git branch -D threw unexpectedly.',
			severity: 'warning',
			workspaceId,
		});
	}
}

/**
 * Deletes child workspace rows and the repository row in a single transaction.
 * Both must succeed or both roll back; partial DB state is the only outcome we
 * cannot tolerate.
 */
function deleteRepositoryRows({
	database,
	repositoryId,
}: {
	database: DatabaseSync;
	repositoryId: string;
}): void {
	database.exec('BEGIN');
	try {
		database
			.prepare('DELETE FROM workspaces WHERE repository_id = ?')
			.run(repositoryId);
		database.prepare('DELETE FROM repositories WHERE id = ?').run(repositoryId);
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

/**
 * Drops the sentinel file Ensemble looks for during shared-root adoption.
 * Without this, the next app start would scan the still-on-disk folder and
 * re-register the repository the user just archived. Failure is non-fatal —
 * the row deletion already succeeded, so we surface a warning and continue.
 */
function writeArchivedMarker({
	diagnostics,
	repositoryPath,
}: {
	diagnostics: ArchiveRepositoryDiagnostic[];
	repositoryPath: string;
}): void {
	if (!existsSync(repositoryPath)) {
		return;
	}
	try {
		writeFileSync(
			path.join(repositoryPath, ARCHIVED_REPOSITORY_MARKER),
			`Archived by Ensemble.\nDelete this file to allow the repository to be re-adopted automatically.\n`,
		);
	} catch (error) {
		diagnostics.push({
			code: 'workspace-cleanup-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to write the archive marker.',
			path: repositoryPath,
			severity: 'warning',
		});
	}
}

/** Builds the standard failure shape for any rejected archive request. */
function failure(
	diagnostic: ArchiveRepositoryDiagnostic,
): ArchiveRepositoryResult {
	return {
		diagnostics: [diagnostic],
		repository: null,
		status: 'failure',
		workspacesArchived: 0,
	};
}

/** Type guard for the repository lookup row. */
function isRepositoryRow(row: unknown): row is {
	id: string;
	name: string;
	path: string;
} {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.name === 'string' &&
		typeof candidate.path === 'string'
	);
}

/** Type guard for the workspace lookup row. */
function isWorkspaceRow(row: unknown): row is SourceWorkspace {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.name === 'string' &&
		typeof candidate.path === 'string' &&
		(candidate.branchName === null || typeof candidate.branchName === 'string')
	);
}

/** Diagnostic type re-export for IPC handler normalisation. */
export type { ArchiveRepositoryDiagnosticCode };
