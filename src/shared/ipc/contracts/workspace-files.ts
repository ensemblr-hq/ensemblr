/** Wire shape for a single repo file surfaced to the renderer. */
export interface WorkspaceFileEntryWire {
	/**
	 * True when git ignores this entry (e.g. `.context/`, `node_modules/`). The
	 * renderer still shows it in the tree but dims it, VS Code style.
	 */
	isIgnored?: boolean;
	kind: 'directory' | 'file';
	name: string;
	path: string;
}

/** Request to list files under a workspace working directory. */
export interface ListWorkspaceFilesRequest {
	workspaceCwd: string;
}

/** Failure reason for a list-workspace-files request. */
export type ListWorkspaceFilesFailureCode =
	| 'command-failed'
	| 'invalid-cwd'
	| 'not-a-git-repo';

/** The workspace file entries, or a typed error on failure. */
export interface ListWorkspaceFilesResult {
	error?: {
		code: ListWorkspaceFilesFailureCode;
		message: string;
	};
	files: readonly WorkspaceFileEntryWire[];
}

/** Request identifying the workspace cwd to start or stop watching for file changes. */
export interface WatchWorkspaceFilesRequest {
	workspaceCwd: string;
}

/** Broadcast announcing that files changed under a watched workspace cwd. */
export interface WorkspaceFilesChangedBroadcast {
	workspaceCwd: string;
}

/** Request to read a single workspace file's contents. */
export interface ReadWorkspaceFileRequest {
	path: string;
	workspaceCwd: string;
}

/** Failure reason for a read-workspace-file request. */
export type ReadWorkspaceFileFailureCode =
	| 'invalid-cwd'
	| 'invalid-path'
	| 'not-found'
	| 'not-file'
	| 'read-failed'
	| 'too-large';

/** The file's contents and size, or a typed error on failure. */
export interface ReadWorkspaceFileResult {
	content?: string;
	error?: {
		code: ReadWorkspaceFileFailureCode;
		message: string;
	};
	path: string;
	sizeBytes?: number;
}

/** Request to enumerate a workspace directory's immediate children. */
export interface ReadWorkspaceDirectoryRequest {
	/** Repo-relative directory path to enumerate. */
	path: string;
	workspaceCwd: string;
}

/** Failure reason for a read-workspace-directory request. */
export type ReadWorkspaceDirectoryFailureCode =
	| 'invalid-cwd'
	| 'invalid-path'
	| 'not-directory'
	| 'read-failed';

/** The directory's immediate child entries, or a typed error on failure. */
export interface ReadWorkspaceDirectoryResult {
	/**
	 * Immediate children of the directory. Used to lazily expand git-ignored
	 * folders (e.g. `node_modules/`) one level at a time, so the tree can browse
	 * any folder regardless of size. Each child is flagged `isIgnored`.
	 */
	entries: readonly WorkspaceFileEntryWire[];
	error?: {
		code: ReadWorkspaceDirectoryFailureCode;
		message: string;
	};
	path: string;
}

/** Workspace files IPC surface — fast file enumeration and safe reads for composer @ mentions. */
export interface WorkspaceFilesApi {
	listWorkspaceFiles: (
		request: ListWorkspaceFilesRequest,
	) => Promise<ListWorkspaceFilesResult>;
	/** Subscribe to file-change broadcasts; returns an unsubscribe callback. */
	onWorkspaceFilesChanged: (
		listener: (event: WorkspaceFilesChangedBroadcast) => void,
	) => () => void;
	/** Lists an ignored directory's immediate children for lazy tree expansion. */
	readWorkspaceDirectory: (
		request: ReadWorkspaceDirectoryRequest,
	) => Promise<ReadWorkspaceDirectoryResult>;
	readWorkspaceFile: (
		request: ReadWorkspaceFileRequest,
	) => Promise<ReadWorkspaceFileResult>;
	/** Stop watching a workspace previously started with `watchWorkspaceFiles`. */
	unwatchWorkspaceFiles: (request: WatchWorkspaceFilesRequest) => Promise<void>;
	/** Start watching a workspace so changes emit `onWorkspaceFilesChanged`. */
	watchWorkspaceFiles: (request: WatchWorkspaceFilesRequest) => Promise<void>;
}
