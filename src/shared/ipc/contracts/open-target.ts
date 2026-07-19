/**
 * Classification of an "Open workspace in…" target. Kept in shared so both the
 * main-process registry and renderer UI can narrow on it.
 */
export type WorkspaceOpenTargetKind =
	| 'editor'
	| 'file-manager'
	| 'source-control'
	| 'terminal'
	| 'utility';

/**
 * Closed set of icon glyphs a target may carry. The renderer maps each value
 * to a concrete component; adding a new variant requires a renderer update,
 * which the type system enforces.
 */
export type WorkspaceOpenTargetIconName =
	| 'lucide:copy'
	| 'lucide:file-code'
	| 'lucide:folder'
	| 'lucide:github'
	| 'lucide:square-terminal'
	| 'lucide:wrench'
	| 'vscode-icons:file-type-vscode'
	| 'vscode-icons:folder-type-github';

/**
 * What the renderer should do after the IPC call succeeds. Mirrors the
 * main-process dispatch kinds but collapses the launch variants since the
 * renderer only cares whether the workspace was launched or the path was
 * copied (so it can swap the toast text).
 */
export type WorkspaceOpenTargetBehavior =
	| 'copy-path'
	| 'launch-app'
	| 'reveal-in-finder';

/** Wire-shape returned for one installed target in the menu. */
export interface WorkspaceOpenTargetSnapshot {
	/** What the renderer does with the result — drives the post-action toast. */
	behavior: WorkspaceOpenTargetBehavior;
	/**
	 * PNG data URL of the actual macOS app icon, when extraction succeeded.
	 * Renderer prefers this over `iconName`. Utility entries (copy-path) and
	 * detection failures leave it undefined and fall back to the named icon.
	 */
	iconDataUrl?: string;
	iconName: WorkspaceOpenTargetIconName;
	id: string;
	installed: boolean;
	isPrimary?: boolean;
	kind: WorkspaceOpenTargetKind;
	label: string;
	numberShortcutLabel: string;
	shortcutLabel?: string;
}

/** Result of listing the "Open in" targets installed for a workspace. */
export interface ListWorkspaceOpenTargetsResult {
	targets: WorkspaceOpenTargetSnapshot[];
}

/** Request to open a workspace, or a path within it, in a chosen target app. */
export interface OpenWorkspaceInTargetRequest {
	/**
	 * Path within the workspace to open instead of its root. Omit to open the
	 * workspace root (the original header behavior).
	 */
	relativePath?: string;
	/**
	 * Whether `relativePath` is a directory or file. Terminal and source-control
	 * targets open the containing directory of a file rather than the file.
	 */
	relativePathKind?: 'directory' | 'file';
	targetId: string;
	workspaceId: string;
}

/**
 * Which settings config file an "Edit in…" action targets. User scope resolves
 * to `~/.config/ensemblr/config.json`; repo scope resolves to the repository's
 * committed `.ensemblr/settings.toml`. Both files are created if missing.
 */
export type SettingsConfigFile =
	| { scope: 'user' }
	| { repositoryPath: string; scope: 'repo' };

/** Request to open a settings config file in a chosen target app. */
export interface OpenSettingsFileInTargetRequest {
	config: SettingsConfigFile;
	targetId: string;
}

/** Result of an open-in-target action: success, or a failure with an error message. */
export type OpenTargetResult = { ok: true } | { error: string; ok: false };

/** IPC surface for the open-in menu. */
export interface OpenTargetApi {
	listWorkspaceOpenTargets: () => Promise<ListWorkspaceOpenTargetsResult>;
	openSettingsFileInTarget: (
		request: OpenSettingsFileInTargetRequest,
	) => Promise<OpenTargetResult>;
	openWorkspaceInTarget: (
		request: OpenWorkspaceInTargetRequest,
	) => Promise<OpenTargetResult>;
}
