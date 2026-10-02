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

/**
 * A one-shot request to scroll a diff to one of its lines and flash it. The
 * `requestId` distinguishes repeat jumps to the same line, which would otherwise
 * resolve to an identical change key and never re-fire.
 */
export interface DiffLineReveal {
	line: number;
	requestId: number;
	side: 'new' | 'old';
}

/** Whether the viewer shows only the diff hunks or the whole expanded file. */
export type DiffViewMode = 'diff' | 'file';

/**
 * One rendered line of the compact diff shown inside a tool row: either a
 * change line carrying its gutters and token slot, or the band standing in for
 * the unchanged lines a patch skipped between hunks.
 */
export type ToolDiffRow =
	| { key: string; kind: 'gap'; label: string }
	| {
			/** Indexes into the per-hunk token sets, which are highlighted apart. */
			hunkIndex: number;
			key: string;
			kind: 'delete' | 'insert' | 'normal';
			lineIndex: number;
			newLine: number | null;
			oldLine: number | null;
			text: string;
	  };
