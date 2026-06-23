import type {
	RootDirectoryChangeApplyResult,
	RootDirectoryChangePreview,
	RootDirectoryChangeRequest,
	RootDirectorySnapshot,
} from '../../shared/ipc/contracts/root-directory';
import type { EnsembleConfigResolutionService } from '../config/config-resolution';
import type { EnsembleDatabaseService } from '../storage/database';
import { ensureRootDirectory } from './root-directory.ts';
import {
	applyRootDirectoryChange,
	previewRootDirectoryChange,
	type RootDirectoryReconciler,
} from './root-directory-change.ts';

/** Public surface of the Ensemble root-directory service. */
export interface EnsembleRootDirectoryService {
	applyChange: (
		request: RootDirectoryChangeRequest,
	) => RootDirectoryChangeApplyResult;
	ensure: () => RootDirectorySnapshot;
	getSnapshot: () => RootDirectorySnapshot | null;
	previewChange: (nextRootPath: string) => RootDirectoryChangePreview;
}

interface CreateEnsembleRootDirectoryServiceOptions {
	allowCreate?: boolean;
	databaseService: EnsembleDatabaseService;
	homeDirectory?: string;
	now?: () => Date;
	reconcileRootDirectory?: RootDirectoryReconciler;
	settingsResolutionService: EnsembleConfigResolutionService;
}

/**
 * Builds the root-directory service that ensures the Ensemble root exists,
 * exposes change preview/apply, and caches the last snapshot for callers.
 */
export function createEnsembleRootDirectoryService({
	allowCreate = true,
	databaseService,
	homeDirectory,
	now,
	reconcileRootDirectory,
	settingsResolutionService,
}: CreateEnsembleRootDirectoryServiceOptions): EnsembleRootDirectoryService {
	let snapshot: RootDirectorySnapshot | null = null;

	function ensure(): RootDirectorySnapshot {
		snapshot = ensureRootDirectory({
			allowCreate,
			database: databaseService.getConnection()?.database ?? null,
			homeDirectory,
			now,
			settingsSnapshot: settingsResolutionService.resolve(),
		});

		return snapshot;
	}

	return {
		applyChange: (request) => {
			const previousRoot = snapshot ?? ensure();
			const result = applyRootDirectoryChange({
				database: databaseService.getConnection()?.database ?? null,
				homeDirectory,
				nextRootPath: request.path,
				now,
				previousRoot,
				reconcileRootDirectory,
				resolveSettingsSnapshot: () => settingsResolutionService.resolve(),
			});

			if (result.applied && result.newRoot) {
				snapshot = result.newRoot;
			}

			return result;
		},
		ensure,
		getSnapshot: () => snapshot,
		previewChange: (nextRootPath) => {
			const previousRoot = snapshot ?? ensure();

			return previewRootDirectoryChange({
				homeDirectory,
				nextRootPath,
				previousRoot,
				settingsSnapshot: settingsResolutionService.resolve(),
			});
		},
	};
}
