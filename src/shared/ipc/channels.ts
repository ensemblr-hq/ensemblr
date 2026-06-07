/**
 * Registry of IPC channel names exchanged between the Electron main process and
 * the renderer. Each value is the wire identifier used by `ipcMain.handle` /
 * `ipcRenderer.invoke`; keys are the camelCase handles used in the preload bridge.
 */
export const IPC_CHANNELS = {
	applyRepositoryConfigMigration: 'ensemble:apply-repository-config-migration',
	confirmRootDirectoryChange: 'ensemble:confirm-root-directory-change',
	ensureWindowWidth: 'ensemble:ensure-window-width',
	environmentVariables: 'ensemble:environment-variables',
	health: 'ensemble:health',
	previewRepositoryConfigMigration:
		'ensemble:preview-repository-config-migration',
	registerLocalRepository: 'ensemble:register-local-repository',
	repositoryConfig: 'ensemble:repository-config',
	repositoryWorkspaceNavigation: 'ensemble:repository-workspace-navigation',
	rootDirectory: 'ensemble:root-directory',
	selectLocalRepository: 'ensemble:select-local-repository',
	selectPiExecutable: 'ensemble:select-pi-executable',
	selectRootDirectory: 'ensemble:select-root-directory',
	setupDiagnostics: 'ensemble:setup-diagnostics',
	settingsResolution: 'ensemble:settings-resolution',
} as const;
