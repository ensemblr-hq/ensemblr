import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type {
	RootDirectoryDiagnostic,
	RootDirectoryReconciliationSnapshot,
	RootDirectorySnapshot,
} from '../../shared/ipc';

/** Options for {@link reconcileRootDirectory}. */
export interface ReconcileRootDirectoryOptions {
	now?: () => Date;
	root: RootDirectorySnapshot;
}

/**
 * Scans the root directory's managed subdirectories, counting repositories and
 * workspaces and surfacing reconciliation diagnostics.
 * @param options - Root snapshot and clock.
 * @returns A {@link RootDirectoryReconciliationSnapshot}.
 */
export function reconcileRootDirectory({
	now = () => new Date(),
	root,
}: ReconcileRootDirectoryOptions): RootDirectoryReconciliationSnapshot {
	const diagnostics: RootDirectoryDiagnostic[] = [];

	if (root.status === 'error') {
		diagnostics.push(...root.diagnostics);

		return createSnapshot({
			diagnostics,
			now,
			repositoryDirectoryCount: 0,
			root,
			workspaceDirectoryCount: 0,
		});
	}

	const repositoryDirectoryCount = countDirectChildDirectories({
		diagnostics,
		directoryPath: root.repositoriesPath,
		label: 'repositories',
	});
	const workspaceDirectoryCount = countWorkspaceDirectories({
		diagnostics,
		workspacesPath: root.workspacesPath,
	});

	return createSnapshot({
		diagnostics,
		now,
		repositoryDirectoryCount,
		root,
		workspaceDirectoryCount,
	});
}

/** Counts workspace directories grouped under per-repository subfolders. */
function countWorkspaceDirectories({
	diagnostics,
	workspacesPath,
}: {
	diagnostics: RootDirectoryDiagnostic[];
	workspacesPath: string;
}): number {
	const repoSlugs = readDirectoryEntries({
		diagnostics,
		directoryPath: workspacesPath,
		label: 'workspaces',
	});

	if (!repoSlugs) {
		return 0;
	}

	let workspaceCount = 0;

	for (const repoSlug of repoSlugs) {
		const repoWorkspacePath = path.join(workspacesPath, repoSlug);
		const repoWorkspaceStats = getStats({
			diagnostics,
			pathLabel: 'workspace repository directory',
			targetPath: repoWorkspacePath,
		});

		if (!repoWorkspaceStats) {
			continue;
		}

		if (!repoWorkspaceStats.isDirectory()) {
			diagnostics.push({
				code: 'reconcile-workspace-repository-not-directory',
				message:
					'A workspaces child is not a directory and cannot be reconciled.',
				path: repoWorkspacePath,
				severity: 'warning',
			});
			continue;
		}

		workspaceCount += countDirectChildDirectories({
			diagnostics,
			directoryPath: repoWorkspacePath,
			label: 'workspace repository',
		});
	}

	return workspaceCount;
}

/** Counts the immediate subdirectories of `directoryPath`, ignoring files. */
function countDirectChildDirectories({
	diagnostics,
	directoryPath,
	label,
}: {
	diagnostics: RootDirectoryDiagnostic[];
	directoryPath: string;
	label: string;
}): number {
	const entries = readDirectoryEntries({
		diagnostics,
		directoryPath,
		label,
	});

	if (!entries) {
		return 0;
	}

	let count = 0;

	for (const entry of entries) {
		const entryPath = path.join(directoryPath, entry);
		const stats = getStats({
			diagnostics,
			pathLabel: `${label} child`,
			targetPath: entryPath,
		});

		if (!stats) {
			continue;
		}

		if (stats.isDirectory()) {
			count += 1;
			continue;
		}

		diagnostics.push({
			code: 'reconcile-child-not-directory',
			message: `A ${label} child is not a directory and will be ignored.`,
			path: entryPath,
			severity: 'warning',
		});
	}

	return count;
}

/** Wraps `readdirSync` with diagnostic-aware error reporting. */
function readDirectoryEntries({
	diagnostics,
	directoryPath,
	label,
}: {
	diagnostics: RootDirectoryDiagnostic[];
	directoryPath: string;
	label: string;
}): string[] | null {
	try {
		return readdirSync(directoryPath).sort();
	} catch (error) {
		diagnostics.push({
			code: 'reconcile-directory-read-failed',
			message: formatFilesystemError(
				error,
				`Failed to read ${label} during root reconciliation.`,
			),
			path: directoryPath,
			severity: 'error',
		});
		return null;
	}
}

/** Wraps `statSync` with diagnostic-aware error reporting. */
function getStats({
	diagnostics,
	pathLabel,
	targetPath,
}: {
	diagnostics: RootDirectoryDiagnostic[];
	pathLabel: string;
	targetPath: string;
}) {
	try {
		return statSync(targetPath);
	} catch (error) {
		diagnostics.push({
			code: 'reconcile-path-stat-failed',
			message: formatFilesystemError(
				error,
				`Failed to inspect ${pathLabel} during root reconciliation.`,
			),
			path: targetPath,
			severity: 'error',
		});
		return null;
	}
}

/** Builds the reconciliation snapshot, deriving status from the root + diagnostics. */
function createSnapshot({
	diagnostics,
	now,
	repositoryDirectoryCount,
	root,
	workspaceDirectoryCount,
}: {
	diagnostics: RootDirectoryDiagnostic[];
	now: () => Date;
	repositoryDirectoryCount: number;
	root: RootDirectorySnapshot;
	workspaceDirectoryCount: number;
}): RootDirectoryReconciliationSnapshot {
	const status =
		root.status === 'error' ||
		diagnostics.some((diagnostic) => diagnostic.severity === 'error')
			? 'error'
			: root.status === 'warning' ||
					diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
				? 'warning'
				: 'ok';

	return {
		diagnostics,
		repositoryDirectoryCount,
		scannedAt: now().toISOString(),
		status,
		workspaceDirectoryCount,
	};
}

/** Coerces a thrown filesystem value into a user-facing message. */
function formatFilesystemError(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}
