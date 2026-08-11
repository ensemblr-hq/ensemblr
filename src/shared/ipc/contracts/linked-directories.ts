/** One directory in the app-global recents list, newest use first. */
export interface LinkedDirectoryRecentWire {
	/**
	 * False when the path no longer resolves to a directory. A folder on an
	 * unmounted volume stays in the list flagged rather than disappearing, so the
	 * user can still recognise and remove it.
	 */
	exists: boolean;
	lastUsedAt: string;
	/** Basename of the directory, shown as the row's and the chip's title. */
	name: string;
	/** Absolute, symlink-resolved path. */
	path: string;
}

/** The app-global recents list. */
export interface ListLinkedDirectoryRecentsResult {
	entries: readonly LinkedDirectoryRecentWire[];
}

/** Names one directory by absolute path. */
export interface LinkedDirectoryRequest {
	path: string;
}

/** Why a directory could not be recorded as linked. */
export type RecordLinkedDirectoryFailureCode =
	| 'invalid-path'
	| 'not-a-directory'
	| 'read-failed';

/** The recorded directory plus the updated recents list, or a typed error. */
export interface RecordLinkedDirectoryResult {
	directory?: LinkedDirectoryRecentWire;
	entries: readonly LinkedDirectoryRecentWire[];
	error?: {
		code: RecordLinkedDirectoryFailureCode;
		message: string;
	};
}

/** Outcome of the native folder picker behind "Browse…". */
export type LinkedDirectorySelectionResult =
	| { canceled: true; path?: undefined }
	| { canceled: false; path: string };

/**
 * Linked-directories IPC surface: the native picker plus the app-global recents
 * list that the composer's directory picker reads. The per-chat set of linked
 * directories is renderer state and never crosses this boundary.
 */
export interface LinkedDirectoriesApi {
	forgetLinkedDirectoryRecent: (
		request: LinkedDirectoryRequest,
	) => Promise<ListLinkedDirectoryRecentsResult>;
	listLinkedDirectoryRecents: () => Promise<ListLinkedDirectoryRecentsResult>;
	recordLinkedDirectoryRecent: (
		request: LinkedDirectoryRequest,
	) => Promise<RecordLinkedDirectoryResult>;
	selectLinkedDirectory: () => Promise<LinkedDirectorySelectionResult>;
}
