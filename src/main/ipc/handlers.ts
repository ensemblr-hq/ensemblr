import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	type OpenDialogOptions,
} from 'electron';

import {
	type EnvironmentVariablesSnapshot,
	type HealthSnapshot,
	IPC_CHANNELS,
	type PiExecutableSelectionResult,
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
} from '../config';
import type { EnvironmentVariablesService } from '../environment';
import type { PiExecutableService } from '../pi';
import type { EnsembleRootDirectoryService } from '../root';
import type { SetupDiagnosticsService } from '../setup';
import type { EnsembleDatabaseService } from '../storage';

const MAX_ENSURED_WINDOW_WIDTH = 2400;

interface RegisterIpcHandlersOptions {
	configService: EnsembleConfigService;
	databaseService: EnsembleDatabaseService;
	environmentVariablesService: EnvironmentVariablesService;
	piExecutableService: PiExecutableService;
	rootDirectoryService: EnsembleRootDirectoryService;
	setupDiagnosticsService: SetupDiagnosticsService;
	settingsResolutionService: EnsembleConfigResolutionService;
}

export function registerIpcHandlers({
	configService,
	databaseService,
	environmentVariablesService,
	piExecutableService,
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
