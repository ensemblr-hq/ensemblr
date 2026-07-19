/** A named preview URL surfaced in the workspace preview picker. */
export interface RepositoryPreviewUrl {
	name: string;
	url: string;
}

/**
 * Personal (SQLite-persisted) repository settings edited on the repo Git and
 * Misc screens. Every field is optional: an omitted field is left untouched,
 * while an explicit `null` (or blank string / empty list) clears the stored row
 * so the value falls back to `.ensemblr/settings.toml`, user defaults, then the
 * built-in default. The committed `.ensemblr/settings.toml` still overrides any
 * of these keys per-key.
 */
export interface RepositorySettingsPatch {
	archiveAfterMerge?: boolean | null;
	branchFrom?: string | null;
	deleteLocalBranchOnArchive?: boolean | null;
	filesToCopy?: string[] | null;
	previewUrls?: RepositoryPreviewUrl[] | null;
	remoteOrigin?: string | null;
}

/** Request to persist a repository's personal settings patch to SQLite. */
export interface UpdateRepositorySettingsRequest {
	repositoryId: string;
	settings: RepositorySettingsPatch;
}

/** Result of a repo-settings write; `ok: false` means validation failed or the SQLite write errored. */
export interface UpdateRepositorySettingsResult {
	ok: boolean;
}

/** Repository-settings slice of the `window.ensemblr` API. */
export interface RepositorySettingsApi {
	updateRepositorySettings: (
		request: UpdateRepositorySettingsRequest,
	) => Promise<UpdateRepositorySettingsResult>;
}
