import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	type OpenDialogOptions,
} from 'electron';

import {
	type CloneDestinationSelectionResult,
	type CloneGithubRepositoryPrepareResult,
	type CloneGithubRepositoryRequest,
	type CloneGithubRepositoryStartRequest,
	type CloneGithubRepositoryStartResult,
	type EnvironmentVariablesSnapshot,
	type GithubRepositoryListResult,
	type HealthSnapshot,
	IPC_CHANNELS,
	type LocalRepositorySelectionResult,
	type PiExecutableSelectionResult,
	type RegisterLocalRepositoryRequest,
	type RegisterLocalRepositoryResult,
	type RepositoryConfigMigrationPreview,
	type RepositoryConfigMigrationRequest,
	type RepositoryConfigMigrationResult,
	type RepositoryConfigRequest,
	type RepositoryConfigSnapshot,
	type RepositoryWorkspaceNavigationSnapshot,
	type RootDirectoryChangeApplyResult,
	type RootDirectoryChangeRequest,
	type RootDirectorySelectionResult,
	type RootDirectorySnapshot,
	type SettingsResolutionSnapshot,
	type SetupDiagnosticsSnapshot,
} from '../../shared/ipc';
import type {
	EnsembleConfigResolutionService,
	EnsembleConfigService,
	RepositoryConfigService,
} from '../config';
import { isRepositoryConfigPathAllowed } from '../config';
import type { EnvironmentVariablesService } from '../environment';
import type { PiExecutableService } from '../pi';
import type {
	GithubCloneService,
	GithubRepositoryListService,
	LocalRepositoryRegistrationService,
} from '../repository';
import type { EnsembleRootDirectoryService } from '../root';
import type { SetupDiagnosticsService } from '../setup';
import type { EnsembleDatabaseService } from '../storage';
import { getRepositoryWorkspaceNavigationSnapshot } from './repository-workspace-navigation';

const MAX_ENSURED_WINDOW_WIDTH = 2400;

/** Dependency bundle wired into the renderer-facing IPC handlers. */
interface RegisterIpcHandlersOptions {
	configService: EnsembleConfigService;
	databaseService: EnsembleDatabaseService;
	environmentVariablesService: EnvironmentVariablesService;
	githubCloneService: GithubCloneService;
	githubRepositoryListService: GithubRepositoryListService;
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	piExecutableService: PiExecutableService;
	repositoryConfigService: RepositoryConfigService;
	rootDirectoryService: EnsembleRootDirectoryService;
	setupDiagnosticsService: SetupDiagnosticsService;
	settingsResolutionService: EnsembleConfigResolutionService;
}

/**
 * Registers every renderer-facing `ipcMain` handler against the
 * preload-bridge contracts in {@link IPC_CHANNELS}.
 * @param options - Service dependencies the handlers delegate to.
 */
export function registerIpcHandlers({
	configService,
	databaseService,
	environmentVariablesService,
	githubCloneService,
	githubRepositoryListService,
	localRepositoryRegistrationService,
	piExecutableService,
	repositoryConfigService,
	rootDirectoryService,
	setupDiagnosticsService,
	settingsResolutionService,
}: RegisterIpcHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.ensureWindowWidth,
		(event, minimumWidth: unknown) => {
			const requestedWidth =
				typeof minimumWidth === 'number' && Number.isFinite(minimumWidth)
					? Math.ceil(minimumWidth)
					: 0;

			if (requestedWidth <= 0) {
				return;
			}

			const window = BrowserWindow.fromWebContents(event.sender);

			if (!window || window.isDestroyed() || window.isFullScreen()) {
				return;
			}

			const targetWidth = Math.min(requestedWidth, MAX_ENSURED_WINDOW_WIDTH);
			const [width, height] = window.getSize();

			if (width < targetWidth) {
				window.setSize(targetWidth, height);
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.environmentVariables,
		(): Promise<EnvironmentVariablesSnapshot> => {
			return environmentVariablesService.getSnapshot();
		},
	);

	ipcMain.handle(IPC_CHANNELS.health, (): HealthSnapshot => {
		return {
			appName: app.getName(),
			config: configService.getSnapshot(),
			database: databaseService.getHealth(),
			platform: process.platform,
			status: 'ok',
			timestamp: new Date().toISOString(),
			versions: {
				chrome: process.versions.chrome,
				electron: process.versions.electron,
				node: process.versions.node,
			},
		};
	});

	ipcMain.handle(IPC_CHANNELS.rootDirectory, (): RootDirectorySnapshot => {
		return rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
	});

	ipcMain.handle(
		IPC_CHANNELS.repositoryConfig,
		(_event, request: unknown): RepositoryConfigSnapshot => {
			const normalizedRequest = normalizeRepositoryConfigRequest(request);

			if (
				normalizedRequest.repositoryPath &&
				!isAllowedRepositoryConfigPath(normalizedRequest.repositoryPath)
			) {
				return createDeniedRepositoryConfigSnapshot(
					normalizedRequest.repositoryPath,
				);
			}

			return repositoryConfigService.load(normalizedRequest);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.repositoryWorkspaceNavigation,
		(): RepositoryWorkspaceNavigationSnapshot => {
			return getRepositoryWorkspaceNavigationSnapshot(
				databaseService.getConnection()?.database ?? null,
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.previewRepositoryConfigMigration,
		(_event, request: unknown): RepositoryConfigMigrationPreview => {
			const normalizedRequest =
				normalizeRepositoryConfigMigrationRequest(request);

			if (
				normalizedRequest.repositoryPath &&
				!isAllowedRepositoryConfigPath(normalizedRequest.repositoryPath)
			) {
				return createDeniedRepositoryConfigMigrationPreview(
					normalizedRequest.repositoryPath,
				);
			}

			return repositoryConfigService.previewMigration(normalizedRequest);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.applyRepositoryConfigMigration,
		(_event, request: unknown): RepositoryConfigMigrationResult => {
			const normalizedRequest =
				normalizeRepositoryConfigMigrationRequest(request);

			if (
				normalizedRequest.repositoryPath &&
				!isAllowedRepositoryConfigPath(normalizedRequest.repositoryPath)
			) {
				return {
					...createDeniedRepositoryConfigMigrationPreview(
						normalizedRequest.repositoryPath,
					),
					applied: false,
					error:
						'Repository config migration can only be applied to a known repository or workspace path.',
				};
			}

			return repositoryConfigService.applyMigration(normalizedRequest);
		},
	);

	/** Wraps {@link isRepositoryConfigPathAllowed} with the current database connection. */
	function isAllowedRepositoryConfigPath(repositoryPath: string): boolean {
		return isRepositoryConfigPathAllowed({
			database: databaseService.getConnection()?.database ?? null,
			repositoryPath,
		});
	}

	ipcMain.handle(
		IPC_CHANNELS.selectLocalRepository,
		async (event): Promise<LocalRepositorySelectionResult> => {
			const window = BrowserWindow.fromWebContents(event.sender);
			const options: OpenDialogOptions = {
				buttonLabel: 'Register repository',
				message:
					'Select an existing local git repository to register with Ensemble.',
				properties: ['openDirectory'],
				title: 'Register local repository',
			};
			const result = window
				? await dialog.showOpenDialog(window, options)
				: await dialog.showOpenDialog(options);

			if (result.canceled || !result.filePaths[0]) {
				return { canceled: true };
			}

			return { canceled: false, path: result.filePaths[0] };
		},
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
		IPC_CHANNELS.selectRootDirectory,
		async (event): Promise<RootDirectorySelectionResult> => {
			const window = BrowserWindow.fromWebContents(event.sender);
			const options: OpenDialogOptions = {
				buttonLabel: 'Preview root',
				message:
					'Select the Ensemble root directory to switch to. Existing contents are only inspected before confirmation.',
				properties: ['openDirectory', 'createDirectory'],
				title: 'Select Ensemble root directory',
			};
			const result = window
				? await dialog.showOpenDialog(window, options)
				: await dialog.showOpenDialog(options);

			if (result.canceled || !result.filePaths[0]) {
				return { canceled: true };
			}

			try {
				return {
					canceled: false,
					preview: rootDirectoryService.previewChange(result.filePaths[0]),
				};
			} catch (error) {
				return {
					canceled: false,
					error:
						error instanceof Error
							? error.message
							: 'Failed to preview the selected root directory.',
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.confirmRootDirectoryChange,
		(_event, request: unknown): RootDirectoryChangeApplyResult => {
			const normalizedRequest = normalizeRootDirectoryChangeRequest(request);

			if (!normalizedRequest.path) {
				return {
					applied: false,
					error: 'No root directory path was selected.',
					newRoot: null,
					oldRoot: rootDirectoryService.getSnapshot(),
					oldRootPreserved: true,
					reconciliation: null,
				};
			}

			return rootDirectoryService.applyChange(normalizedRequest);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.selectPiExecutable,
		async (event): Promise<PiExecutableSelectionResult> => {
			const window = BrowserWindow.fromWebContents(event.sender);
			const options: OpenDialogOptions = {
				buttonLabel: 'Select Pi executable',
				message:
					'Select a Pi-compatible executable or wrapper script, such as pi or oh-my-pi.',
				properties: ['openFile'],
				title: 'Select Pi executable',
			};
			const result = window
				? await dialog.showOpenDialog(window, options)
				: await dialog.showOpenDialog(options);

			if (result.canceled || !result.filePaths[0]) {
				return { canceled: true };
			}

			return piExecutableService.saveOverride(result.filePaths[0]);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.githubRepositoryList,
		(): Promise<GithubRepositoryListResult> => {
			return githubRepositoryListService.list();
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.selectCloneDestination,
		async (event): Promise<CloneDestinationSelectionResult> => {
			const window = BrowserWindow.fromWebContents(event.sender);
			const options: OpenDialogOptions = {
				buttonLabel: 'Select destination',
				message:
					'Select the parent directory where the GitHub repository should be cloned.',
				properties: ['openDirectory', 'createDirectory'],
				title: 'Select clone destination',
			};
			const result = window
				? await dialog.showOpenDialog(window, options)
				: await dialog.showOpenDialog(options);

			if (result.canceled || !result.filePaths[0]) {
				return { canceled: true };
			}

			return { canceled: false, path: result.filePaths[0] };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.cloneGithubRepositoryPrepare,
		(_event, request: unknown): Promise<CloneGithubRepositoryPrepareResult> => {
			return githubCloneService.prepare(
				normalizeCloneGithubRepositoryRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.cloneGithubRepositoryStart,
		(event, request: unknown): Promise<CloneGithubRepositoryStartResult> => {
			const normalized = normalizeCloneGithubRepositoryStartRequest(request);
			return githubCloneService.start(normalized, {
				onProgress: (payload) => {
					if (event.sender.isDestroyed()) {
						return;
					}
					event.sender.send(
						IPC_CHANNELS.cloneGithubRepositoryProgress,
						payload,
					);
				},
			});
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.setupDiagnostics,
		(): Promise<SetupDiagnosticsSnapshot> => {
			return setupDiagnosticsService.getSnapshot();
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.settingsResolution,
		(_event, request: unknown): SettingsResolutionSnapshot => {
			return settingsResolutionService.resolve(request);
		},
	);
}

/** Coerces an IPC payload into a {@link RootDirectoryChangeRequest}. */
function normalizeRootDirectoryChangeRequest(
	request: unknown,
): RootDirectoryChangeRequest {
	if (
		typeof request !== 'object' ||
		request === null ||
		!('path' in request) ||
		typeof request.path !== 'string'
	) {
		return { path: '' };
	}

	return { path: request.path.trim() };
}

/** Coerces an IPC payload into a {@link CloneGithubRepositoryRequest}. */
function normalizeCloneGithubRepositoryRequest(
	request: unknown,
): CloneGithubRepositoryRequest {
	if (typeof request !== 'object' || request === null) {
		return { url: '' };
	}

	const url =
		'url' in request && typeof request.url === 'string' ? request.url : '';
	const destinationPath =
		'destinationPath' in request && typeof request.destinationPath === 'string'
			? request.destinationPath
			: undefined;

	return destinationPath !== undefined ? { destinationPath, url } : { url };
}

/** Coerces an IPC payload into a {@link CloneGithubRepositoryStartRequest}. */
function normalizeCloneGithubRepositoryStartRequest(
	request: unknown,
): CloneGithubRepositoryStartRequest {
	if (
		typeof request !== 'object' ||
		request === null ||
		!('jobId' in request) ||
		typeof request.jobId !== 'string'
	) {
		return { jobId: '' };
	}

	return { jobId: request.jobId };
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

	return { path: request.path.trim() };
}

/** Coerces an IPC payload into a {@link RepositoryConfigRequest}. */
function normalizeRepositoryConfigRequest(
	request: unknown,
): RepositoryConfigRequest {
	if (
		typeof request !== 'object' ||
		request === null ||
		!('repositoryPath' in request) ||
		typeof request.repositoryPath !== 'string'
	) {
		return { repositoryPath: '' };
	}

	return { repositoryPath: request.repositoryPath.trim() };
}

/** Coerces an IPC payload into a {@link RepositoryConfigMigrationRequest}. */
function normalizeRepositoryConfigMigrationRequest(
	request: unknown,
): RepositoryConfigMigrationRequest {
	if (
		typeof request !== 'object' ||
		request === null ||
		!('repositoryPath' in request) ||
		typeof request.repositoryPath !== 'string'
	) {
		return { repositoryPath: '' };
	}

	return {
		overwrite:
			'overwrite' in request && request.overwrite === true ? true : undefined,
		repositoryPath: request.repositoryPath.trim(),
	};
}

/** Returns a synthetic snapshot used when a path is not authorised. */
function createDeniedRepositoryConfigSnapshot(
	repositoryPath: string,
): RepositoryConfigSnapshot {
	return {
		diagnostics: [
			{
				code: 'repository-config-path-not-allowed',
				message:
					'Repository config can only be loaded for a known repository or workspace path.',
				severity: 'error',
			},
		],
		loadedAt: new Date().toISOString(),
		repositoryPath,
		sources: [],
	};
}

/** Returns a synthetic migration preview used when a path is not authorised. */
function createDeniedRepositoryConfigMigrationPreview(
	repositoryPath: string,
): RepositoryConfigMigrationPreview {
	return {
		canApply: false,
		changes: [],
		diagnostics: [
			{
				code: 'repository-config-path-not-allowed',
				message:
					'Repository config migration can only be applied to a known repository or workspace path.',
				severity: 'error',
			},
		],
		repositoryPath,
		resultingConfig: {},
		sourcePath: null,
		targetExists: false,
		targetPath: '',
	};
}
