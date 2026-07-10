import type {
	RootDirectoryChangeApplyResult,
	RootDirectoryChangePreview,
	RootDirectoryChangeRequest,
	RootDirectorySnapshot,
} from '../../shared/ipc/contracts/root-directory';
import type { EnsemblrConfigResolutionService } from '../config/config-resolution';
import type { EnsemblrDatabaseService } from '../storage/database';
import { ensureRootDirectory } from './root-directory.ts';
import {
	applyRootDirectoryChange,
	previewRootDirectoryChange,
	type RootDirectoryReconciler,
} from './root-directory-change.ts';

/** Public surface of the Ensemblr root-directory service. */
export interface EnsemblrRootDirectoryService {
	applyChange: (
		request: RootDirectoryChangeRequest,
	) => RootDirectoryChangeApplyResult;
	ensure: () => RootDirectorySnapshot;
	getSnapshot: () => RootDirectorySnapshot | null;
	previewChange: (nextRootPath: string) => RootDirectoryChangePreview;
}

/** Options for {@link createEnsemblrRootDirectoryService}. */
interface CreateEnsemblrRootDirectoryServiceOptions {
	allowCreate?: boolean;
	databaseService: EnsemblrDatabaseService;
	homeDirectory?: string;
	now?: () => Date;
	reconcileRootDirectory?: RootDirectoryReconciler;
	settingsResolutionService: EnsemblrConfigResolutionService;
}

/**
 * Builds the root-directory service that ensures the Ensemblr root exists,
 * exposes change preview/apply, and caches the last snapshot for callers.
 */
export function createEnsemblrRootDirectoryService({
	allowCreate = true,
	databaseService,
	homeDirectory,
	now,
	reconcileRootDirectory,
	settingsResolutionService,
}: CreateEnsemblrRootDirectoryServiceOptions): EnsemblrRootDirectoryService {
	let snapshot: RootDirectorySnapshot | null = null;

	/**
	 * Ensure the Ensemblr root directory exists and cache the resulting snapshot.
	 * @returns The current root-directory snapshot
	 */
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
