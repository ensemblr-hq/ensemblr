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

/** Wire-shape returned for one installed target in the menu. */
export interface WorkspaceOpenTargetSnapshot {
	/**
	 * PNG data URL of the actual macOS app icon, when extraction succeeded.
	 * Renderer prefers this over `iconName`. Utility entries (copy-path) and
	 * detection failures leave it undefined and fall back to the named icon.
	 */
	iconDataUrl?: string;
	iconName: string;
	id: string;
	installed: boolean;
	isPrimary?: boolean;
	kind: WorkspaceOpenTargetKind;
	label: string;
	numberShortcutLabel: string;
	shortcutLabel?: string;
}

export interface ListWorkspaceOpenTargetsResult {
	targets: WorkspaceOpenTargetSnapshot[];
}

export interface OpenWorkspaceInTargetRequest {
	targetId: string;
	workspaceId: string;
}

export type OpenTargetResult =
	| { ok: true }
	| { error: string; ok: false };

/** IPC surface for the open-in menu. */
export interface OpenTargetApi {
	listWorkspaceOpenTargets: () => Promise<ListWorkspaceOpenTargetsResult>;
	openWorkspaceInTarget: (
		request: OpenWorkspaceInTargetRequest,
	) => Promise<OpenTargetResult>;
}
