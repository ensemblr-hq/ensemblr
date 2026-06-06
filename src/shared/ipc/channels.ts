export const IPC_CHANNELS = {
	applyRepositoryConfigMigration: 'ensemble:apply-repository-config-migration',
	confirmRootDirectoryChange: 'ensemble:confirm-root-directory-change',
	ensureWindowWidth: 'ensemble:ensure-window-width',
	environmentVariables: 'ensemble:environment-variables',
	health: 'ensemble:health',
	previewRepositoryConfigMigration:
		'ensemble:preview-repository-config-migration',
	repositoryConfig: 'ensemble:repository-config',
	rootDirectory: 'ensemble:root-directory',
	selectPiExecutable: 'ensemble:select-pi-executable',
	selectRootDirectory: 'ensemble:select-root-directory',
	setupDiagnostics: 'ensemble:setup-diagnostics',
	settingsResolution: 'ensemble:settings-resolution',
} as const;
