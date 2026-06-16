/** Wire shape for a single repo file surfaced to the renderer. */
export interface WorkspaceFileEntryWire {
	kind: 'directory' | 'file';
	name: string;
	path: string;
}

export interface ListWorkspaceFilesRequest {
	workspaceCwd: string;
}

export type ListWorkspaceFilesFailureCode =
	| 'command-failed'
	| 'invalid-cwd'
	| 'not-a-git-repo';

export interface ListWorkspaceFilesResult {
	error?: {
		code: ListWorkspaceFilesFailureCode;
		message: string;
	};
	files: readonly WorkspaceFileEntryWire[];
}

export interface WatchWorkspaceFilesRequest {
	workspaceCwd: string;
}

/** Broadcast announcing that files changed under a watched workspace cwd. */
export interface WorkspaceFilesChangedBroadcast {
	workspaceCwd: string;
}

export interface ReadWorkspaceFileRequest {
	path: string;
	workspaceCwd: string;
}

export type ReadWorkspaceFileFailureCode =
	| 'invalid-cwd'
	| 'invalid-path'
	| 'not-found'
	| 'not-file'
	| 'read-failed'
	| 'too-large';

export interface ReadWorkspaceFileResult {
	content?: string;
	error?: {
		code: ReadWorkspaceFileFailureCode;
		message: string;
	};
	path: string;
	sizeBytes?: number;
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
	readWorkspaceFile: (
		request: ReadWorkspaceFileRequest,
	) => Promise<ReadWorkspaceFileResult>;
	/** Stop watching a workspace previously started with `watchWorkspaceFiles`. */
	unwatchWorkspaceFiles: (request: WatchWorkspaceFilesRequest) => Promise<void>;
	/** Start watching a workspace so changes emit `onWorkspaceFilesChanged`. */
	watchWorkspaceFiles: (request: WatchWorkspaceFilesRequest) => Promise<void>;
}
