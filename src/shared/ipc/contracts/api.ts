import type { ArchiveApi } from './archive-lifecycle';
import type { ChatTabApi } from './chat-tab';
import type { CheckpointApi } from './checkpoint';
import type { CloneApi } from './clone';
import type { EnvironmentApi } from './environment';
import type { GithubApi } from './github';
import type { HealthApi } from './health';
import type { LinearApi } from './linear';
import type { PiApi, PiSessionApi } from './pi-session';
import type { QuickStartApi } from './quick-start';
import type { RepositoryApi } from './repository';
import type { RepositoryConfigApi } from './repository-config';
import type { NavigationApi, ShellApi } from './repository-navigation';
import type { ReviewCommentsApi } from './review-comments';
import type { RootDirectoryApi } from './root-directory';
import type { SettingsApi } from './settings-resolution';
import type { SetupApi } from './setup';
import type { SharedRootApi } from './shared-root-adoption';
import type { TerminalApi } from './terminal';
import type { WorkspaceApi } from './workspace';
import type { WorkspaceFilesApi } from './workspace-files';
import type { WorkspaceGitApi } from './workspace-git';
import type { WorkspaceScriptsApi } from './workspace-scripts';

/**
 * Aggregate IPC surface exposed to the renderer through the preload bridge.
 *
 * Each per-domain sub-API owns its slice of `window.ensemble` (workspaces, Pi
 * sessions, clone progress, etc.). Composing them here keeps the channel
 * registry's 1:1 method-name mapping intact while letting each domain evolve
 * its contract next to the wire types it depends on.
 */
export interface EnsembleApi
	extends WorkspaceApi,
		RepositoryApi,
		PiSessionApi,
		ChatTabApi,
		CloneApi,
		ArchiveApi,
		RootDirectoryApi,
		EnvironmentApi,
		SetupApi,
		HealthApi,
		SettingsApi,
		ShellApi,
		NavigationApi,
		QuickStartApi,
		RepositoryConfigApi,
		SharedRootApi,
		WorkspaceFilesApi,
		WorkspaceGitApi,
		GithubApi,
		ReviewCommentsApi,
		CheckpointApi,
		TerminalApi,
		WorkspaceScriptsApi,
		PiApi,
		LinearApi {}
