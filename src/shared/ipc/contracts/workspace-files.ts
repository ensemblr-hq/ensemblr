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
	readWorkspaceFile: (
		request: ReadWorkspaceFileRequest,
	) => Promise<ReadWorkspaceFileResult>;
}
