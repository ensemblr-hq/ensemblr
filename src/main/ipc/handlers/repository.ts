import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { QuickStartProjectResult } from '../../../shared/ipc/contracts/quick-start';
import type {
	ArchiveRepositoryResult,
	DeleteRepositoryResult,
	LocalRepositorySelectionResult,
	RegisterLocalRepositoryResult,
} from '../../../shared/ipc/contracts/repository';
import type { SharedRootAdoptionSnapshot } from '../../../shared/ipc/contracts/shared-root-adoption';
import type {
	ArchiveWorkspaceResult,
	CreateWorkspaceResult,
	DeleteArchivedWorkspaceResult,
	DeleteWorkspaceResult,
	ListArchivedWorkspacesResult,
	RenameWorkspaceResult,
	UnarchiveWorkspaceResult,
} from '../../../shared/ipc/contracts/workspace';
import type {
	ArchiveRepositoryService,
	ArchiveWorkspaceService,
	CreateWorkspaceService,
	DeleteArchivedWorkspaceService,
	DeleteRepositoryService,
	DeleteWorkspaceService,
	ListArchivedWorkspacesService,
	LocalRepositoryImportService,
	LocalRepositoryRegistrationService,
	QuickStartProjectService,
	RenameWorkspaceService,
	SharedRootAdoptionService,
	UnarchiveWorkspaceService,
} from '../../repository';
import type { WithPermissionGate } from '../permission-gate.ts';
import {
	parseArchiveRepositoryRequest,
	parseArchiveWorkspaceRequest,
	parseCreateWorkspaceRequest,
	parseDeleteArchivedWorkspaceRequest,
	parseDeleteRepositoryRequest,
	parseDeleteWorkspaceRequest,
	parseListArchivedWorkspacesRequest,
	parseQuickStartProjectRequest,
	parseRegisterLocalRepositoryRequest,
	parseRenameWorkspaceRequest,
	parseUnarchiveWorkspaceRequest,
} from '../request-schemas.ts';
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
	localRepositoryImportService: LocalRepositoryImportService;
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	quickStartProjectService: QuickStartProjectService;
	renameWorkspaceService: RenameWorkspaceService;
	sharedRootAdoptionService: SharedRootAdoptionService;
	unarchiveWorkspaceService: UnarchiveWorkspaceService;
	withPermissionGate: WithPermissionGate;
}

/**
 * Registers IPC handlers for picking, importing, registering, and quick-starting
 * local repositories.
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
	localRepositoryImportService,
	localRepositoryRegistrationService,
	quickStartProjectService,
	renameWorkspaceService,
	sharedRootAdoptionService,
	unarchiveWorkspaceService,
	withPermissionGate,
}: RepositoryHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.selectLocalRepository,
		(event): Promise<LocalRepositorySelectionResult> =>
			showDirectorySelectionDialog(event, {
				buttonLabel: 'Open project',
				message: 'Select an existing local git project to copy into Ensemble.',
				properties: ['openDirectory'],
				title: 'Open local project',
			}),
	);

	ipcMain.handle(
		IPC_CHANNELS.importLocalRepository,
		(_event, raw: unknown): Promise<RegisterLocalRepositoryResult> =>
			localRepositoryImportService.importRepository(
				parseRegisterLocalRepositoryRequest(raw),
			),
	);

	ipcMain.handle(
		IPC_CHANNELS.registerLocalRepository,
		(_event, raw: unknown): Promise<RegisterLocalRepositoryResult> =>
			localRepositoryRegistrationService.register(
				parseRegisterLocalRepositoryRequest(raw),
			),
	);

	ipcMain.handle(
		IPC_CHANNELS.quickStartProject,
		(_event, raw: unknown): Promise<QuickStartProjectResult> =>
			quickStartProjectService.create(parseQuickStartProjectRequest(raw)),
	);

	ipcMain.handle(
		IPC_CHANNELS.createWorkspace,
		(_event, raw: unknown): Promise<CreateWorkspaceResult> =>
			createWorkspaceService.create(parseCreateWorkspaceRequest(raw)),
	);

	ipcMain.handle(
		IPC_CHANNELS.sharedRootAdoption,
		(): Promise<SharedRootAdoptionSnapshot> =>
			sharedRootAdoptionService.reconcile(),
	);

	ipcMain.handle(
		IPC_CHANNELS.renameWorkspace,
		(_event, raw: unknown): Promise<RenameWorkspaceResult> =>
			renameWorkspaceService.rename(parseRenameWorkspaceRequest(raw)),
	);

	ipcMain.handle(
		IPC_CHANNELS.archiveWorkspace,
		(_event, raw: unknown): Promise<ArchiveWorkspaceResult> =>
			archiveWorkspaceService.archive(parseArchiveWorkspaceRequest(raw)),
	);

	withPermissionGate(
		IPC_CHANNELS.archiveRepository,
		'repository-removal',
		(_event, raw: unknown): Promise<ArchiveRepositoryResult> =>
			archiveRepositoryService.archive(parseArchiveRepositoryRequest(raw)),
	);

	withPermissionGate(
		IPC_CHANNELS.deleteWorkspace,
		'workspace-archive-delete',
		(_event, raw: unknown): Promise<DeleteWorkspaceResult> =>
			deleteWorkspaceService.delete(parseDeleteWorkspaceRequest(raw)),
	);

	withPermissionGate(
		IPC_CHANNELS.deleteRepository,
		'repository-removal',
		(_event, raw: unknown): Promise<DeleteRepositoryResult> =>
			deleteRepositoryService.delete(parseDeleteRepositoryRequest(raw)),
	);

	ipcMain.handle(
		IPC_CHANNELS.listArchivedWorkspaces,
		(_event, raw: unknown): Promise<ListArchivedWorkspacesResult> =>
			listArchivedWorkspacesService.list(
				parseListArchivedWorkspacesRequest(raw),
			),
	);

	ipcMain.handle(
		IPC_CHANNELS.unarchiveWorkspace,
		(_event, raw: unknown): Promise<UnarchiveWorkspaceResult> =>
			unarchiveWorkspaceService.unarchive(parseUnarchiveWorkspaceRequest(raw)),
	);

	withPermissionGate(
		IPC_CHANNELS.deleteArchivedWorkspace,
		'workspace-archive-delete',
		(_event, raw: unknown): Promise<DeleteArchivedWorkspaceResult> =>
			deleteArchivedWorkspaceService.delete(
				parseDeleteArchivedWorkspaceRequest(raw),
			),
	);
}
