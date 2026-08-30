import type { AppLanguage } from '../../i18n';
import type { WindowChromeSnapshot } from '../../window-chrome';
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
	/** Language the main process resolved, so the first paint is never English by default. */
	language: AppLanguage;
	navigation: RepositoryWorkspaceNavigationSnapshot | null;
	openTargets: WorkspaceOpenTargetSnapshot[] | null;
	/**
	 * The chrome the running window was actually constructed with, so the shell
	 * insets its toolbars and mounts its controls to match rather than
	 * re-deriving a setting the window may predate.
	 */
	windowChrome: WindowChromeSnapshot;
}
