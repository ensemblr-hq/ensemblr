import type { HealthSnapshot } from './health';
import type { RepositoryWorkspaceNavigationSnapshot } from './repository-navigation';

export interface InitialShellSnapshot {
	capturedAt: string;
	health: HealthSnapshot | null;
	navigation: RepositoryWorkspaceNavigationSnapshot | null;
}
