import type {
	ArchiveWorkspaceService,
	CreateWorkspaceService,
} from '../repository';
import type { ScriptLifecycleService } from './script-lifecycle-service.ts';

/**
 * Decorates workspace creation so the configured setup script runs
 * automatically after a successful create (ADR 0007 parity), then chains the
 * run script when the repository enables `autoRunAfterSetup`. Script failures
 * surface in the dock; they never block or fail creation.
 * @param input - Base service plus the script lifecycle service.
 * @returns A {@link CreateWorkspaceService} with the setup-script hook.
 */
export function withSetupScriptOnCreate({
	createWorkspaceService,
	scriptLifecycleService,
}: {
	createWorkspaceService: CreateWorkspaceService;
	scriptLifecycleService: ScriptLifecycleService;
}): CreateWorkspaceService {
	return {
		create: async (request) => {
			const result = await createWorkspaceService.create(request);
			const workspaceId = result.workspace?.id;

			if (result.status === 'success' && workspaceId) {
				void scriptLifecycleService
					.runSetupScriptWithAutoRun({ workspaceId })
					.catch(() => {});
			}

			return result;
		},
	};
}

/**
 * Decorates workspace archiving so the configured archive script runs (with a
 * bounded wait) before the archive proceeds. Script failures never block the
 * archive.
 * @param input - Base service plus the script lifecycle service.
 * @returns An {@link ArchiveWorkspaceService} with the archive-script hook.
 */
export function withArchiveScriptBeforeArchive({
	archiveWorkspaceService,
	scriptLifecycleService,
}: {
	archiveWorkspaceService: ArchiveWorkspaceService;
	scriptLifecycleService: ScriptLifecycleService;
}): ArchiveWorkspaceService {
	return {
		archive: async (request) => {
			if (typeof request?.workspaceId === 'string' && request.workspaceId) {
				await scriptLifecycleService
					.runArchiveScriptAndWait({ workspaceId: request.workspaceId })
					.catch(() => {});
			}

			return archiveWorkspaceService.archive(request);
		},
	};
}
