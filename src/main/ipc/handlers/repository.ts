import { ipcMain } from 'electron';

import {
	type ArchiveRepositoryRequest,
	type ArchiveRepositoryResult,
	type ArchiveWorkspaceRequest,
	type ArchiveWorkspaceResult,
	type CreateWorkspaceRequest,
	type CreateWorkspaceResult,
	type DeleteArchivedWorkspaceRequest,
	type DeleteArchivedWorkspaceResult,
	type DeleteRepositoryRequest,
	type DeleteRepositoryResult,
	type DeleteWorkspaceRequest,
	type DeleteWorkspaceResult,
	IPC_CHANNELS,
	type ListArchivedWorkspacesRequest,
	type ListArchivedWorkspacesResult,
	type LocalRepositorySelectionResult,
	type QuickStartProjectRequest,
	type QuickStartProjectResult,
	type RegisterLocalRepositoryRequest,
	type RegisterLocalRepositoryResult,
	type RenameWorkspaceRequest,
	type RenameWorkspaceResult,
	type SharedRootAdoptionSnapshot,
	type UnarchiveWorkspaceRequest,
	type UnarchiveWorkspaceResult,
} from '../../../shared/ipc';
import type {
	ArchiveRepositoryService,
	ArchiveWorkspaceService,
	CreateWorkspaceService,
	DeleteArchivedWorkspaceService,
	DeleteRepositoryService,
	DeleteWorkspaceService,
	ListArchivedWorkspacesService,
	LocalRepositoryRegistrationService,
	QuickStartProjectService,
	RenameWorkspaceService,
	SharedRootAdoptionService,
	UnarchiveWorkspaceService,
} from '../../repository';
import { showDirectorySelectionDialog } from './dialog-helpers.ts';

/** Service dependencies used by the local-repository IPC handlers. */
export interface RepositoryHandlersOptions {
	archiveRepositoryService: ArchiveRepositoryService;
	archiveWorkspaceService: ArchiveWorkspaceService;
	createWorkspaceService: CreateWorkspaceService;
	deleteArchivedWorkspaceService: DeleteArchivedWorkspaceService;
	deleteRepositoryService: DeleteRepositoryService;
	deleteWorkspaceService: DeleteWorkspaceService;
	listArchivedWorkspacesService: ListArchivedWorkspacesService;
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	quickStartProjectService: QuickStartProjectService;
	renameWorkspaceService: RenameWorkspaceService;
	sharedRootAdoptionService: SharedRootAdoptionService;
	unarchiveWorkspaceService: UnarchiveWorkspaceService;
}

/**
 * Registers IPC handlers for picking, registering, and quick-starting local
 * repositories.
 * @param options - Required services.
 */
export function registerRepositoryHandlers({
	archiveRepositoryService,
	archiveWorkspaceService,
	createWorkspaceService,
	deleteArchivedWorkspaceService,
	deleteRepositoryService,
	deleteWorkspaceService,
	listArchivedWorkspacesService,
	localRepositoryRegistrationService,
	quickStartProjectService,
	renameWorkspaceService,
	sharedRootAdoptionService,
	unarchiveWorkspaceService,
}: RepositoryHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.selectLocalRepository,
		(event): Promise<LocalRepositorySelectionResult> =>
			showDirectorySelectionDialog(event, {
				buttonLabel: 'Register repository',
				message:
					'Select an existing local git repository to register with Ensemble.',
				properties: ['openDirectory'],
				title: 'Register local repository',
			}),
	);

	ipcMain.handle(
		IPC_CHANNELS.registerLocalRepository,
		(_event, request: unknown): Promise<RegisterLocalRepositoryResult> => {
			return localRepositoryRegistrationService.register(
				normalizeRegisterLocalRepositoryRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.quickStartProject,
		(_event, request: unknown): Promise<QuickStartProjectResult> => {
			return quickStartProjectService.create(
				normalizeQuickStartProjectRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.createWorkspace,
		(_event, request: unknown): Promise<CreateWorkspaceResult> => {
			return createWorkspaceService.create(
				normalizeCreateWorkspaceRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.sharedRootAdoption,
		(): Promise<SharedRootAdoptionSnapshot> => {
			return sharedRootAdoptionService.reconcile();
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.renameWorkspace,
		(_event, request: unknown): Promise<RenameWorkspaceResult> => {
			return renameWorkspaceService.rename(
				normalizeRenameWorkspaceRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.archiveWorkspace,
		(_event, request: unknown): Promise<ArchiveWorkspaceResult> => {
			return archiveWorkspaceService.archive(
				normalizeArchiveWorkspaceRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.archiveRepository,
		(_event, request: unknown): Promise<ArchiveRepositoryResult> => {
			return archiveRepositoryService.archive(
				normalizeArchiveRepositoryRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.deleteWorkspace,
		(_event, request: unknown): Promise<DeleteWorkspaceResult> => {
			return deleteWorkspaceService.delete(
				normalizeDeleteWorkspaceRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.deleteRepository,
		(_event, request: unknown): Promise<DeleteRepositoryResult> => {
			return deleteRepositoryService.delete(
				normalizeDeleteRepositoryRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listArchivedWorkspaces,
		(_event, request: unknown): Promise<ListArchivedWorkspacesResult> => {
			return listArchivedWorkspacesService.list(
				normalizeListArchivedWorkspacesRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.unarchiveWorkspace,
		(_event, request: unknown): Promise<UnarchiveWorkspaceResult> => {
			return unarchiveWorkspaceService.unarchive(
				normalizeUnarchiveWorkspaceRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.deleteArchivedWorkspace,
		(_event, request: unknown): Promise<DeleteArchivedWorkspaceResult> => {
			return deleteArchivedWorkspaceService.delete(
				normalizeDeleteArchivedWorkspaceRequest(request),
			);
		},
	);
}

/** Coerces an IPC payload into a {@link RegisterLocalRepositoryRequest}. */
function normalizeRegisterLocalRepositoryRequest(
	request: unknown,
): RegisterLocalRepositoryRequest {
	if (
		typeof request !== 'object' ||
		request === null ||
		!('path' in request) ||
		typeof request.path !== 'string'
	) {
		return { path: '' };
	}

	const candidate = request as Record<string, unknown>;
	const normalized: RegisterLocalRepositoryRequest = {
		path: (candidate.path as string).trim(),
	};
	if (typeof candidate.name === 'string') {
		normalized.name = candidate.name;
	}
	return normalized;
}

/** Coerces an IPC payload into a {@link QuickStartProjectRequest}. */
function normalizeQuickStartProjectRequest(
	request: unknown,
): QuickStartProjectRequest {
	if (typeof request !== 'object' || request === null) {
		return { name: '' };
	}

	const name =
		'name' in request && typeof request.name === 'string' ? request.name : '';
	const parentPath =
		'parentPath' in request && typeof request.parentPath === 'string'
			? request.parentPath
			: undefined;

	return parentPath !== undefined ? { name, parentPath } : { name };
}

/** Coerces an IPC payload into a {@link RenameWorkspaceRequest}. */
function normalizeRenameWorkspaceRequest(
	request: unknown,
): RenameWorkspaceRequest {
	if (typeof request !== 'object' || request === null) {
		return { workspaceId: '' };
	}
	const candidate = request as Record<string, unknown>;
	const workspaceId =
		typeof candidate.workspaceId === 'string' ? candidate.workspaceId : '';
	const normalized: RenameWorkspaceRequest = { workspaceId };
	if (typeof candidate.name === 'string') {
		normalized.name = candidate.name;
	}
	if (typeof candidate.branchName === 'string') {
		normalized.branchName = candidate.branchName;
	}
	return normalized;
}

/** Coerces an IPC payload into a {@link ArchiveWorkspaceRequest}. */
function normalizeArchiveWorkspaceRequest(
	request: unknown,
): ArchiveWorkspaceRequest {
	if (typeof request !== 'object' || request === null) {
		return { workspaceId: '' };
	}
	const candidate = request as Record<string, unknown>;
	const workspaceId =
		typeof candidate.workspaceId === 'string' ? candidate.workspaceId : '';
	const normalized: ArchiveWorkspaceRequest = { workspaceId };
	if (typeof candidate.branchCleanup === 'boolean') {
		normalized.branchCleanup = candidate.branchCleanup;
	}
	if (typeof candidate.reason === 'string') {
		normalized.reason = candidate.reason;
	}
	return normalized;
}

/** Coerces an IPC payload into a {@link ArchiveRepositoryRequest}. */
function normalizeArchiveRepositoryRequest(
	request: unknown,
): ArchiveRepositoryRequest {
	if (typeof request !== 'object' || request === null) {
		return { repositoryId: '' };
	}
	const candidate = request as Record<string, unknown>;
	const repositoryId =
		typeof candidate.repositoryId === 'string' ? candidate.repositoryId : '';
	const normalized: ArchiveRepositoryRequest = { repositoryId };
	if (typeof candidate.branchCleanup === 'boolean') {
		normalized.branchCleanup = candidate.branchCleanup;
	}
	if (typeof candidate.reason === 'string') {
		normalized.reason = candidate.reason;
	}
	return normalized;
}

/** Coerces an IPC payload into a {@link DeleteWorkspaceRequest}. */
function normalizeDeleteWorkspaceRequest(
	request: unknown,
): DeleteWorkspaceRequest {
	if (typeof request !== 'object' || request === null) {
		return { workspaceId: '' };
	}
	const candidate = request as Record<string, unknown>;
	const workspaceId =
		typeof candidate.workspaceId === 'string' ? candidate.workspaceId : '';
	return { workspaceId };
}

/** Coerces an IPC payload into a {@link DeleteRepositoryRequest}. */
function normalizeDeleteRepositoryRequest(
	request: unknown,
): DeleteRepositoryRequest {
	if (typeof request !== 'object' || request === null) {
		return { repositoryId: '' };
	}
	const candidate = request as Record<string, unknown>;
	const repositoryId =
		typeof candidate.repositoryId === 'string' ? candidate.repositoryId : '';
	return { repositoryId };
}

/** Coerces an IPC payload into a {@link ListArchivedWorkspacesRequest}. */
function normalizeListArchivedWorkspacesRequest(
	request: unknown,
): ListArchivedWorkspacesRequest {
	if (typeof request !== 'object' || request === null) {
		return { repositoryId: '' };
	}
	const candidate = request as Record<string, unknown>;
	const repositoryId =
		typeof candidate.repositoryId === 'string' ? candidate.repositoryId : '';
	return { repositoryId };
}

/** Coerces an IPC payload into a {@link UnarchiveWorkspaceRequest}. */
function normalizeUnarchiveWorkspaceRequest(
	request: unknown,
): UnarchiveWorkspaceRequest {
	if (typeof request !== 'object' || request === null) {
		return { workspaceId: '' };
	}
	const candidate = request as Record<string, unknown>;
	const workspaceId =
		typeof candidate.workspaceId === 'string' ? candidate.workspaceId : '';
	const normalized: UnarchiveWorkspaceRequest = { workspaceId };
	if (typeof candidate.reason === 'string') {
		normalized.reason = candidate.reason;
	}
	return normalized;
}

/** Coerces an IPC payload into a {@link DeleteArchivedWorkspaceRequest}. */
function normalizeDeleteArchivedWorkspaceRequest(
	request: unknown,
): DeleteArchivedWorkspaceRequest {
	if (typeof request !== 'object' || request === null) {
		return { workspaceId: '' };
	}
	const candidate = request as Record<string, unknown>;
	const workspaceId =
		typeof candidate.workspaceId === 'string' ? candidate.workspaceId : '';
	return { workspaceId };
}

/** Coerces an IPC payload into a {@link CreateWorkspaceRequest}. */
function normalizeCreateWorkspaceRequest(
	request: unknown,
): CreateWorkspaceRequest {
	if (typeof request !== 'object' || request === null) {
		return { repositoryId: '' };
	}
	const candidate = request as Record<string, unknown>;
	return {
		repositoryId:
			typeof candidate.repositoryId === 'string' ? candidate.repositoryId : '',
		...(typeof candidate.name === 'string' && { name: candidate.name }),
		...(typeof candidate.branchName === 'string' && {
			branchName: candidate.branchName,
		}),
		...(typeof candidate.baseBranch === 'string' && {
			baseBranch: candidate.baseBranch,
		}),
	};
}
