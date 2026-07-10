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

/** Request to persist a pasted image under the workspace `.context/` folder. */
export interface WriteWorkspaceImageAttachmentRequest {
	contentBase64: string;
	mimeType: string;
	name?: string;
	workspaceCwd: string;
}

/** Request to persist a pasted non-image file under the workspace `.context/attachments/` folder. */
export interface WriteWorkspaceFileAttachmentRequest {
	contentBase64: string;
	name?: string;
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

/** Failure reason for a pasted-image write request. */
export type WriteWorkspaceImageAttachmentFailureCode =
	| 'invalid-cwd'
	| 'invalid-image'
	| 'invalid-path'
	| 'write-failed';

/** Result of persisting a pasted image as a workspace file attachment. */
export interface WriteWorkspaceImageAttachmentResult {
	error?: {
		code: WriteWorkspaceImageAttachmentFailureCode;
		message: string;
	};
	file?: WorkspaceFileEntryWire;
	sizeBytes?: number;
}

/** Failure reason for a pasted-file attachment write request. */
export type WriteWorkspaceFileAttachmentFailureCode =
	| 'invalid-attachment'
	| 'invalid-cwd'
	| 'invalid-path'
	| 'too-large'
	| 'write-failed';

/** Result of persisting a pasted non-image file as a workspace file attachment. */
export interface WriteWorkspaceFileAttachmentResult {
	error?: {
		code: WriteWorkspaceFileAttachmentFailureCode;
		message: string;
	};
	file?: WorkspaceFileEntryWire;
	sizeBytes?: number;
}

/** Request to enumerate a workspace directory's immediate children. */
export interface ReadWorkspaceDirectoryRequest {
	/** Repo-relative directory path to enumerate. */
	path: string;
	workspaceCwd: string;
}

/** Failure reason for a read-workspace-directory request. */
type ReadWorkspaceDirectoryFailureCode =
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

/** Workspace files IPC surface — fast file enumeration, safe reads, and pasted-attachment writes. */
export interface WorkspaceFilesApi {
	/**
	 * Resolves the absolute filesystem path of a dragged or pasted `File`, or an
	 * empty string when it has none (e.g. an in-memory clipboard blob). Backed by
	 * Electron `webUtils.getPathForFile` in the preload; not an IPC round-trip, so
	 * the live `File` never crosses to the main process.
	 */
	getPathForFile: (file: File) => string;
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
	/** Persist a pasted composer image under `.context/images/`. */
	writeWorkspaceImageAttachment: (
		request: WriteWorkspaceImageAttachmentRequest,
	) => Promise<WriteWorkspaceImageAttachmentResult>;
	/** Persist a pasted composer non-image file under `.context/attachments/`. */
	writeWorkspaceFileAttachment: (
		request: WriteWorkspaceFileAttachmentRequest,
	) => Promise<WriteWorkspaceFileAttachmentResult>;
	/** Stop watching a workspace previously started with `watchWorkspaceFiles`. */
	unwatchWorkspaceFiles: (request: WatchWorkspaceFilesRequest) => Promise<void>;
	/** Start watching a workspace so changes emit `onWorkspaceFilesChanged`. */
	watchWorkspaceFiles: (request: WatchWorkspaceFilesRequest) => Promise<void>;
}
