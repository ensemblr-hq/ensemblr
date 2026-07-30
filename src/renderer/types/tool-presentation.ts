import type { BundledLanguage } from 'shiki';

/** Whether a tool row reads as ordinary activity or as a failure. */
export type ToolTone = 'default' | 'destructive';

/**
 * Icon key identifying a tool at rest. Kept as a string rather than a component
 * so tool projection stays a pure data transform outside the render tree.
 */
export type ToolGlyph =
	| 'biceps-flexed'
	| 'bot'
	| 'brain'
	| 'circle-x'
	| 'clipboard-list'
	| 'file-diff'
	| 'file-pen'
	| 'file-plus'
	| 'file-text'
	| 'folder-tree'
	| 'kanban'
	| 'list'
	| 'message-circle-question'
	| 'message-square-text'
	| 'panels-top-left'
	| 'puzzle'
	| 'search'
	| 'stethoscope'
	| 'terminal'
	| 'wrench';

/**
 * Persistent chip pinned beside a tool title. Unlike a preview it survives
 * expansion, so the file under discussion stays on screen while its body reads.
 */
export interface ToolBadgeDescriptor {
	/** Added-line count for an edit; null when the tool reports no diff. */
	additions: number | null;
	deletions: number | null;
	kind: 'file' | 'folder';
	path: string;
}

/** Collapsed-only one-line summary of what a row's body will show. */
export interface ToolPreviewDescriptor {
	/** `sans` for prose summaries, `mono` for commands, paths, and patterns. */
	font: 'mono' | 'sans';
	text: string;
}

/** Severity of one language-server diagnostic, ordered most to least severe. */
export type ToolDiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/** One language-server diagnostic rendered inside a diagnostics body. */
export interface ToolDiagnosticEntry {
	column: number | null;
	line: number | null;
	message: string;
	severity: ToolDiagnosticSeverity;
	/** Reporting server, e.g. `typescript`; null when the payload omits it. */
	source: string | null;
}

/** One labelled plain-text block inside a labelled-payload body. */
export interface ToolPanelSectionDescriptor {
	/** Painted verbatim — punctuation such as a trailing colon belongs here. */
	label: string;
	/** Dims the block that is context rather than the answer. */
	muted: boolean;
	text: string;
}

/**
 * What a tool row renders once expanded. Each variant maps to exactly one body
 * component, so adding a tool means choosing a variant rather than writing a
 * renderer.
 */
export type ToolBodyDescriptor =
	| {
			code: string;
			kind: 'code';
			language: BundledLanguage;
			/** Numbers the gutter from a real file offset; null leaves it off. */
			startLine: number | null;
	  }
	| { entries: readonly ToolDiagnosticEntry[]; kind: 'diagnostics' }
	| { kind: 'diff'; language: BundledLanguage; patch: string }
	| { kind: 'empty' }
	| { kind: 'error'; text: string }
	| { kind: 'labeled'; sections: readonly ToolPanelSectionDescriptor[] }
	| { kind: 'markdown'; text: string }
	| { kind: 'pending' }
	| { kind: 'stack-trace'; trace: string }
	| { kind: 'terminal'; text: string };

/**
 * Everything a tool row needs to render one call, derived from the tool part
 * before any component runs. The four fields answer the four questions that
 * separate one tool row from another: which glyph, what it says, what stays
 * pinned, and what unfolds.
 */
export interface ToolPresentation {
	badge: ToolBadgeDescriptor | null;
	body: ToolBodyDescriptor;
	glyph: ToolGlyph;
	preview: ToolPreviewDescriptor | null;
	title: string;
	tone: ToolTone;
}
