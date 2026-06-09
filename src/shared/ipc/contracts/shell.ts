import type { HealthSnapshot } from './health';
import type { RepositoryWorkspaceNavigationSnapshot } from './repository-navigation';

export interface InitialShellSnapshot {
	capturedAt: string;
	health: HealthSnapshot | null;
	navigation: RepositoryWorkspaceNavigationSnapshot | null;
}

/** Window/shell-level IPC surface (resize the BrowserWindow, etc). */
export interface ShellApi {
	ensureWindowWidth: (minimumWidth: number) => Promise<void>;
}
