/** Where a diff comment originates, which drives its badge and editability. */
export type DiffCommentSource = 'github' | 'github-actions' | 'local';

/** A single comment anchored to a diff line, from Ensemblr-local or GitHub. */
export interface DiffComment {
	author?: string;
	body: string;
	id: string;
	isOutdated?: boolean;
	isResolved?: boolean;
	source: DiffCommentSource;
	url?: string;
}

/** Whether the viewer shows only the diff hunks or the whole expanded file. */
export type DiffViewMode = 'diff' | 'file';
