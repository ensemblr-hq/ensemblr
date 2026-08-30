export { createMainWindow } from './main-window';
export type {
	QuitCoordinator,
	QuitCoordinatorOptions,
} from './quit-coordinator';
export { createQuitCoordinator } from './quit-coordinator';
export type { QuitGuard, QuitGuardOptions } from './quit-guard';
export { createQuitGuard } from './quit-guard';
export { resolveUserDataDirectory } from './user-data-location';
export type { WindowChromeOptions } from './window-chrome';
export { resolveWindowChromeOptions } from './window-chrome';
export type { MainWindowStateStore } from './window-state';
export {
	createMainWindowStateStore,
	forbidsWindowPositioning,
} from './window-state';
