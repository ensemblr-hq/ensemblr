import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
	ApplySettingsPublicationRequest,
	ApplySettingsPublicationResult,
	CleanupSettingsPublicationRequest,
	CleanupSettingsPublicationResult,
	PreviewSettingsPublicationRequest,
	PreviewSettingsPublicationResult,
	RestoreSettingsPublicationRequest,
	RestoreSettingsPublicationResult,
	SettingsPublicationFailure,
	SettingsPublicationFailureCode,
	SettingsPublicationRecoveryStatusRequest,
	SettingsPublicationRecoveryStatusResult,
	SettingsPublicationSourceStatus,
} from '../../shared/ipc/contracts/settings-publication.ts';
import type { EnsemblrDatabaseService } from '../storage/database.ts';
import {
	dropRetainedRepositoryScripts,
	readPendingRepositoryScripts,
} from './repository-scripts-migration.ts';
import { writeRepositoryScripts } from './repository-scripts-writer.ts';
import {
	assertFingerprint,
	captureHeadSettings,
	captureSettingsFile,
	decode,
	fingerprintGit,
	hasStagedOrConflictedSettings,
	mergeSettingsFiles,
	readGitStatus,
	SettingsPublicationError,
	sameCapturedFile,
	validateRepositoryPair,
	validateToml,
	writeCapturedSettings,
} from './settings-publication-files.ts';
import {
	type CapturedSettingsFile,
	createSettingsPublicationRecoveryStore,
	type SettingsGitFingerprint,
	type StoredSettingsPublicationRecovery,
} from './settings-publication-recovery.ts';
import {
	resolveWorkspaceSettingsTarget,
	type WorkspaceSettingsTarget,
} from './workspace-settings-target.ts';

const MAX_PREVIEWS = 32;

/** Backend-owned preview state retained until a bounded apply attempt. */
interface PreparedSettingsPublication {
	base: CapturedSettingsFile;
	destination: CapturedSettingsFile;
	destinationGit: SettingsGitFingerprint;
	hasLegacyScripts: boolean;
	merged: CapturedSettingsFile;
	repositoryId: string;
	source: CapturedSettingsFile;
	sourceGit: SettingsGitFingerprint;
	status: 'clean' | 'conflict';
	token: string;
	workspaceId: string;
}

/** Public settings publication operations used by IPC handlers. */
export interface SettingsPublicationService {
	apply: (
		request: ApplySettingsPublicationRequest,
	) => ApplySettingsPublicationResult;
	cleanup: (
		request: CleanupSettingsPublicationRequest,
	) => CleanupSettingsPublicationResult;
	preview: (
		request: PreviewSettingsPublicationRequest,
	) => PreviewSettingsPublicationResult;
	recoveryStatus: (
		request: SettingsPublicationRecoveryStatusRequest,
	) => SettingsPublicationRecoveryStatusResult;
	restore: (
		request: RestoreSettingsPublicationRequest,
	) => RestoreSettingsPublicationResult;
}

/** Dependencies for the settings publication service. */
export interface CreateSettingsPublicationServiceOptions {
	databaseService: Pick<EnsemblrDatabaseService, 'getConnection'>;
	now?: () => Date;
	recoveryDirectory: string;
}

/**
 * Creates the guarded root-to-workspace settings publication workflow.
 * @param options - Database, app-owned recovery directory, and optional clock.
 * @returns Publication, cleanup, and recovery operations.
 */
export function createSettingsPublicationService({
	databaseService,
	now = () => new Date(),
	recoveryDirectory,
}: CreateSettingsPublicationServiceOptions): SettingsPublicationService {
	const previews = new Map<string, PreparedSettingsPublication>();
	const recoveries = createSettingsPublicationRecoveryStore(recoveryDirectory);

	/** Resolves an unchanged, live workspace target from backend-owned ids. */
	function targetFor(
		repositoryId: string,
		workspaceId: string,
	): WorkspaceSettingsTarget {
		const database = databaseService.getConnection()?.database;
		if (!database) {
			throw new SettingsPublicationError(
				'database-unavailable',
				'Ensemblr storage is not available.',
			);
		}
		const target = resolveWorkspaceSettingsTarget({
			database,
			repositoryId,
			workspaceId,
		});
		if (!target) {
			throw new SettingsPublicationError(
				'target-not-found',
				'The selected workspace is unavailable or belongs to another repository.',
			);
		}
		validateRepositoryPair(target);
		return target;
	}

	/**
	 * Drops the retained SQLite script rows a verified publication has just
	 * written onto the workspace branch. Without this the rows keep making the
	 * root look like it has unpublished settings forever, since nothing else
	 * drains them now that the launch-time root-writing pass is gone.
	 * @param repositoryId - Repository whose retained rows were published.
	 */
	function drainRetainedScripts(repositoryId: string): void {
		const database = databaseService.getConnection()?.database;
		if (!database) {
			return;
		}
		dropRetainedRepositoryScripts({ database, repositoryId });
	}

	/** Prepares a bounded native three-way merge without mutating either checkout. */
	function preview(
		request: PreviewSettingsPublicationRequest,
	): PreviewSettingsPublicationResult {
		try {
			const target = targetFor(request.repositoryId, request.workspaceId);
			const database = databaseService.getConnection()?.database;
			if (!database) {
				throw new SettingsPublicationError(
					'database-unavailable',
					'Ensemblr storage is not available.',
				);
			}
			const source = captureSettingsFile(target.repositoryPath, 'source');
			const destination = captureSettingsFile(target.workspacePath, 'target');
			const base = captureHeadSettings(target.repositoryPath);
			const pending = prepareSourceWithLegacy({
				database,
				repositoryId: request.repositoryId,
				source,
			});
			const sourceStatus = classifySource({
				base,
				hasLegacyScripts: pending.hasLegacyScripts,
				source,
			});
			validateToml(pending.source, 'source-invalid');
			validateToml(destination, 'target-invalid');
			const merged = mergeSettingsFiles({
				base,
				destination,
				source: pending.source,
			});
			if (merged.status === 'clean') {
				validateToml(merged.file, 'source-invalid');
			}
			const token = randomUUID();
			const prepared: PreparedSettingsPublication = {
				base,
				destination,
				destinationGit: fingerprintGit(target.workspacePath, destination),
				hasLegacyScripts: pending.hasLegacyScripts,
				merged: merged.file,
				repositoryId: request.repositoryId,
				source,
				sourceGit: fingerprintGit(target.repositoryPath, source),
				status: merged.status,
				token,
				workspaceId: request.workspaceId,
			};
			previews.set(token, prepared);
			trimPreviews(previews);

			return {
				failure: null,
				preview: {
					hasLegacyScripts: pending.hasLegacyScripts,
					mergedText: decode(prepared.merged),
					repositoryId: request.repositoryId,
					sourceStatus,
					status: prepared.status,
					token,
					workspaceId: request.workspaceId,
				},
			};
		} catch (error) {
			return { failure: toFailure(error), preview: null };
		}
	}

	/** Applies a clean preview after every source fingerprint still matches. */
	function apply(
		request: ApplySettingsPublicationRequest,
	): ApplySettingsPublicationResult {
		const prepared = previews.get(request.previewToken);
		previews.delete(request.previewToken);
		if (
			!prepared ||
			prepared.repositoryId !== request.repositoryId ||
			prepared.workspaceId !== request.workspaceId
		) {
			return failedApply(
				'preview-not-found',
				'That publication preview expired.',
			);
		}
		if (prepared.status !== 'clean') {
			return failedApply(
				'merge-failed',
				'Conflicted settings cannot be applied automatically.',
			);
		}

		try {
			const target = targetFor(request.repositoryId, request.workspaceId);
			assertFingerprint(target.repositoryPath, prepared.sourceGit, 'source');
			assertFingerprint(
				target.workspacePath,
				prepared.destinationGit,
				'destination',
			);
			const recoveryId = randomUUID();
			const recovery: StoredSettingsPublicationRecovery = {
				appliedAt: null,
				base: prepared.base,
				cleanedAt: null,
				destination: prepared.destination,
				destinationApplied: null,
				destinationGit: prepared.destinationGit,
				id: recoveryId,
				repositoryId: request.repositoryId,
				source: prepared.source,
				sourceAfterCleanup: null,
				sourceGit: prepared.sourceGit,
				version: 1,
				workspaceId: request.workspaceId,
			};
			recoveries.write(recovery);
			writeCapturedSettings(target.workspacePath, prepared.merged);
			const written = captureSettingsFile(target.workspacePath, 'target');
			if (written.hash !== prepared.merged.hash) {
				throw new SettingsPublicationError(
					'write-failed',
					'The workspace settings write could not be verified.',
				);
			}
			recoveries.write({
				...recovery,
				appliedAt: now().toISOString(),
				destinationApplied: written,
			});
			if (prepared.hasLegacyScripts) {
				drainRetainedScripts(request.repositoryId);
			}
			return { failure: null, recoveryId, status: 'applied' };
		} catch (error) {
			return { failure: toFailure(error), recoveryId: null, status: 'failed' };
		}
	}

	/** Restores the root to HEAD only after the copied destination is unchanged. */
	function cleanup(
		request: CleanupSettingsPublicationRequest,
	): CleanupSettingsPublicationResult {
		try {
			const recovery = requireRecovery(recoveries.read(request.recoveryId));
			if (!recovery.appliedAt || !recovery.destinationApplied) {
				throw new SettingsPublicationError(
					'recovery-failed',
					'The recovery does not describe a verified publication.',
				);
			}
			const target = targetFor(recovery.repositoryId, recovery.workspaceId);
			const rootStatus = readGitStatus(target.repositoryPath);
			if (hasStagedOrConflictedSettings(rootStatus)) {
				throw new SettingsPublicationError(
					'cleanup-unsafe',
					'Root settings are staged, partially staged, or conflicted.',
				);
			}
			assertFingerprint(target.repositoryPath, recovery.sourceGit, 'source');
			const destination = captureSettingsFile(target.workspacePath, 'target');
			if (!sameCapturedFile(destination, recovery.destinationApplied)) {
				throw new SettingsPublicationError(
					'destination-changed',
					'Workspace settings changed after publication.',
				);
			}
			writeCapturedSettings(target.repositoryPath, recovery.base);
			const sourceAfterCleanup = captureSettingsFile(
				target.repositoryPath,
				'source',
			);
			if (!sameCapturedFile(sourceAfterCleanup, recovery.base)) {
				throw new SettingsPublicationError(
					'write-failed',
					'Root cleanup could not be verified.',
				);
			}
			recoveries.write({
				...recovery,
				cleanedAt: now().toISOString(),
				sourceAfterCleanup,
			});
			return { failure: null, status: 'cleaned' };
		} catch (error) {
			return { failure: toFailure(error), status: 'failed' };
		}
	}

	/** Restores one captured side only when no intervening edit would be lost. */
	function restore(
		request: RestoreSettingsPublicationRequest,
	): RestoreSettingsPublicationResult {
		try {
			const recovery = requireRecovery(recoveries.read(request.recoveryId));
			const target = targetFor(recovery.repositoryId, recovery.workspaceId);
			if (request.copy === 'destination') {
				if (!recovery.destinationApplied) {
					throw new SettingsPublicationError(
						'recovery-failed',
						'The destination write was never verified.',
					);
				}
				const current = captureSettingsFile(target.workspacePath, 'target');
				if (!sameCapturedFile(current, recovery.destinationApplied)) {
					throw new SettingsPublicationError(
						'destination-changed',
						'Workspace settings changed after publication.',
					);
				}
				writeCapturedSettings(target.workspacePath, recovery.destination);
			} else {
				if (!recovery.sourceAfterCleanup) {
					throw new SettingsPublicationError(
						'recovery-failed',
						'The root copy has not been cleaned.',
					);
				}
				const current = captureSettingsFile(target.repositoryPath, 'source');
				if (!sameCapturedFile(current, recovery.sourceAfterCleanup)) {
					throw new SettingsPublicationError(
						'source-changed',
						'Root settings changed after cleanup.',
					);
				}
				writeCapturedSettings(target.repositoryPath, recovery.source);
			}
			return { failure: null, status: 'restored' };
		} catch (error) {
			return { failure: toFailure(error), status: 'failed' };
		}
	}

	/** Lists content-free durable recovery metadata for one repository. */
	function recoveryStatus(
		request: SettingsPublicationRecoveryStatusRequest,
	): SettingsPublicationRecoveryStatusResult {
		try {
			return {
				failure: null,
				recoveries: recoveries.list(request.repositoryId),
			};
		} catch (error) {
			return { failure: toFailure(error), recoveries: [] };
		}
	}

	return { apply, cleanup, preview, recoveryStatus, restore };
}

/** Reads and folds retained script defaults into an app-owned temporary copy. */
function prepareSourceWithLegacy({
	database,
	repositoryId,
	source,
}: {
	database: NonNullable<
		ReturnType<EnsemblrDatabaseService['getConnection']>
	>['database'];
	repositoryId: string;
	source: CapturedSettingsFile;
}): { hasLegacyScripts: boolean; source: CapturedSettingsFile } {
	const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'ensemblr-settings-'));
	try {
		if (source.exists) {
			writeCapturedSettings(temporaryRoot, source);
		}
		const pending = readPendingRepositoryScripts({
			database,
			repositoryId,
			repositoryPath: temporaryRoot,
		});
		if (!pending) {
			return { hasLegacyScripts: false, source };
		}
		const result = writeRepositoryScripts({
			...pending,
			repositoryPath: temporaryRoot,
		});
		if (!result.ok) {
			throw new SettingsPublicationError('source-invalid', result.message);
		}
		return {
			hasLegacyScripts: true,
			source: captureSettingsFile(temporaryRoot, 'source'),
		};
	} finally {
		rmSync(temporaryRoot, { force: true, recursive: true });
	}
}

/** Determines whether root contributes modified, deleted, untracked, or legacy-only data. */
function classifySource({
	base,
	hasLegacyScripts,
	source,
}: {
	base: CapturedSettingsFile;
	hasLegacyScripts: boolean;
	source: CapturedSettingsFile;
}): SettingsPublicationSourceStatus {
	if (!base.exists && !source.exists) {
		if (hasLegacyScripts) {
			return 'missing';
		}
		throw new SettingsPublicationError(
			'source-missing',
			'Root settings have no unpublished changes.',
		);
	}
	if (!base.exists) {
		return 'untracked';
	}
	if (!source.exists) {
		return 'deleted';
	}
	if (base.hash === source.hash && !hasLegacyScripts) {
		throw new SettingsPublicationError(
			'source-missing',
			'Root settings have no unpublished changes.',
		);
	}
	return 'modified';
}

/** Retains only the newest bounded set of backend-owned previews. */
function trimPreviews(
	previews: Map<string, PreparedSettingsPublication>,
): void {
	while (previews.size > MAX_PREVIEWS) {
		const oldest = previews.keys().next().value;
		if (typeof oldest !== 'string') {
			return;
		}
		previews.delete(oldest);
	}
}

/** Requires a durable recovery record. */
function requireRecovery(
	recovery: StoredSettingsPublicationRecovery | null,
): StoredSettingsPublicationRecovery {
	if (!recovery) {
		throw new SettingsPublicationError(
			'recovery-not-found',
			'That settings recovery is unavailable.',
		);
	}
	return recovery;
}

/** Builds a failed apply envelope. */
function failedApply(
	code: SettingsPublicationFailureCode,
	message: string,
): ApplySettingsPublicationResult {
	return { failure: { code, message }, recoveryId: null, status: 'failed' };
}

/**
 * Normalizes thrown values into a non-secret IPC failure. An unexpected throw
 * carries filesystem paths in its message, so the renderer gets an authored
 * sentence and the operator gets the original in the main-process log. It also
 * gets its own code rather than a recovery-specific one: preview, apply, and
 * cleanup all reach here, and each would otherwise name the wrong operation.
 * @param error - Value thrown by one guarded operation.
 * @returns The renderer-safe failure envelope.
 */
function toFailure(error: unknown): SettingsPublicationFailure {
	if (error instanceof SettingsPublicationError) {
		return { code: error.code, message: error.message };
	}
	console.error('[settings-publication] unexpected failure', error);
	return {
		code: 'publication-unexpected',
		message: 'Settings publication failed unexpectedly.',
	};
}
