export const IPC_CHANNELS = {
	confirmRootDirectoryChange: 'ensemble:confirm-root-directory-change',
	ensureWindowWidth: 'ensemble:ensure-window-width',
	environmentVariables: 'ensemble:environment-variables',
	health: 'ensemble:health',
	rootDirectory: 'ensemble:root-directory',
	selectPiExecutable: 'ensemble:select-pi-executable',
	selectRootDirectory: 'ensemble:select-root-directory',
	setupDiagnostics: 'ensemble:setup-diagnostics',
	settingsResolution: 'ensemble:settings-resolution',
} as const;
