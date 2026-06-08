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
		(
			_event,
			request: RegisterLocalRepositoryRequest,
		): Promise<RegisterLocalRepositoryResult> =>
			localRepositoryRegistrationService.register(request),
	);

	ipcMain.handle(
		IPC_CHANNELS.quickStartProject,
		(
			_event,
			request: QuickStartProjectRequest,
		): Promise<QuickStartProjectResult> =>
			quickStartProjectService.create(request),
	);

	ipcMain.handle(
		IPC_CHANNELS.createWorkspace,
		(
			_event,
			request: CreateWorkspaceRequest,
		): Promise<CreateWorkspaceResult> => createWorkspaceService.create(request),
	);

	ipcMain.handle(
		IPC_CHANNELS.sharedRootAdoption,
		(): Promise<SharedRootAdoptionSnapshot> =>
			sharedRootAdoptionService.reconcile(),
	);

	ipcMain.handle(
		IPC_CHANNELS.renameWorkspace,
		(
			_event,
			request: RenameWorkspaceRequest,
		): Promise<RenameWorkspaceResult> => renameWorkspaceService.rename(request),
	);

	ipcMain.handle(
		IPC_CHANNELS.archiveWorkspace,
		(
			_event,
			request: ArchiveWorkspaceRequest,
		): Promise<ArchiveWorkspaceResult> =>
			archiveWorkspaceService.archive(request),
	);

	ipcMain.handle(
		IPC_CHANNELS.archiveRepository,
		(
			_event,
			request: ArchiveRepositoryRequest,
		): Promise<ArchiveRepositoryResult> =>
			archiveRepositoryService.archive(request),
	);

	ipcMain.handle(
		IPC_CHANNELS.deleteWorkspace,
		(
			_event,
			request: DeleteWorkspaceRequest,
		): Promise<DeleteWorkspaceResult> => deleteWorkspaceService.delete(request),
	);

	ipcMain.handle(
		IPC_CHANNELS.deleteRepository,
		(
			_event,
			request: DeleteRepositoryRequest,
		): Promise<DeleteRepositoryResult> =>
			deleteRepositoryService.delete(request),
	);

	ipcMain.handle(
		IPC_CHANNELS.listArchivedWorkspaces,
		(
			_event,
			request: ListArchivedWorkspacesRequest,
		): Promise<ListArchivedWorkspacesResult> =>
			listArchivedWorkspacesService.list(request),
	);

	ipcMain.handle(
		IPC_CHANNELS.unarchiveWorkspace,
		(
			_event,
			request: UnarchiveWorkspaceRequest,
		): Promise<UnarchiveWorkspaceResult> =>
			unarchiveWorkspaceService.unarchive(request),
	);

	ipcMain.handle(
		IPC_CHANNELS.deleteArchivedWorkspace,
		(
			_event,
			request: DeleteArchivedWorkspaceRequest,
		): Promise<DeleteArchivedWorkspaceResult> =>
			deleteArchivedWorkspaceService.delete(request),
	);
}
