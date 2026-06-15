import type { HealthSnapshot } from './health';
import type { WorkspaceOpenTargetSnapshot } from './open-target';
import type { RepositoryWorkspaceNavigationSnapshot } from './repository-navigation';

/**
 * Single-shot hydration payload sent to the renderer on app start. Bundles the
 * health + navigation snapshots + the installed "open in…" target list so the
 * first paint can render without a second round-trip.
 */
export interface InitialShellSnapshot {
	capturedAt: string;
	health: HealthSnapshot | null;
	navigation: RepositoryWorkspaceNavigationSnapshot | null;
	openTargets: WorkspaceOpenTargetSnapshot[] | null;
}
