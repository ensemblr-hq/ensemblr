/**
 * Desktop app frameworks the workbench can recognize from a workspace's
 * manifest so the dock offers a Launch button instead of a browser-only Open.
 */
export type DesktopFramework = 'electron' | 'tauri';

/**
 * Detected desktop-app runtime for a workspace, or `null` when the project is a
 * plain web/server project (or has no recognizable desktop toolchain). Carried
 * to the renderer so the dock can render a framework-aware Launch affordance.
 */
export interface WorkspaceDesktopRuntime {
	/**
	 * macOS application name passed to `open -a <appName>`, when it could be
	 * resolved from the manifest. `open -a` focuses a matching app bundle if one
	 * is running and otherwise launches it, matched by name — so a dev build and
	 * an installed release sharing a name are indistinguishable here. Null means
	 * the name was unresolvable and activation fails rather than guessing.
	 */
	appName: string | null;
	framework: DesktopFramework;
}

/** Request to detect the desktop runtime of a workspace by id. */
export interface DetectWorkspaceDesktopRuntimeRequest {
	workspaceId: string;
}

/** Result of a desktop-runtime detection: the runtime, or `null` when none. */
export interface DetectWorkspaceDesktopRuntimeResult {
	runtime: WorkspaceDesktopRuntime | null;
}

/** Request to focus a workspace's already-running desktop app window. */
export interface ActivateWorkspaceDesktopAppRequest {
	workspaceId: string;
}

/**
 * Result of a focus attempt: success, or a failure with a message. A missing
 * app name or non-macOS host resolves to a failure the renderer can toast.
 */
export type ActivateWorkspaceDesktopAppResult =
	| { ok: true }
	| { error: string; ok: false };

/** IPC surface for desktop-runtime detection and window focus. */
export interface WorkspaceRuntimeApi {
	activateWorkspaceDesktopApp: (
		request: ActivateWorkspaceDesktopAppRequest,
	) => Promise<ActivateWorkspaceDesktopAppResult>;
	detectWorkspaceDesktopRuntime: (
		request: DetectWorkspaceDesktopRuntimeRequest,
	) => Promise<DetectWorkspaceDesktopRuntimeResult>;
}
