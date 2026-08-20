import type { BundledLanguage } from 'shiki';

/** Whether a tool row reads as ordinary activity or as a failure. */
export type ToolTone = 'default' | 'destructive';

/**
 * Icon key identifying a tool at rest. Kept as a string rather than a component
 * so tool projection stays a pure data transform outside the render tree.
 */
export type ToolGlyph =
	| 'bell'
	| 'biceps-flexed'
	| 'bot'
	| 'brain'
	| 'circle-stop'
	| 'circle-x'
	| 'clipboard-list'
	| 'crosshair'
	| 'file-diff'
	| 'file-pen'
	| 'file-plus'
	| 'file-text'
	| 'folder-tree'
	| 'hourglass'
	| 'image'
	| 'kanban'
	| 'keyboard'
	| 'list'
	| 'message-circle-question'
	| 'message-square-check'
	| 'message-square-plus'
	| 'message-square-text'
	| 'panels-top-left'
	| 'play'
	| 'puzzle'
	| 'scroll-text'
	| 'search'
	| 'send'
	| 'square-terminal'
	| 'square-x'
	| 'stethoscope'
	| 'terminal'
	| 'ticket'
	| 'ticket-check'
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

/** Where one checklist item stands, as the agent's own task list reports it. */
export type ToolChecklistStatus =
	| 'pending'
	| 'in-progress'
	| 'completed'
	| 'unknown';

/** One task rendered inside a checklist body. */
export interface ToolChecklistItem {
	/** Second line under the subject — a description or an owner; null when none. */
	detail: string | null;
	/**
	 * Identity that survives the call it came from settling, so a plan still
	 * streaming does not remount its rows as the harness answers with numbers.
	 */
	id: string;
	/** The task's own number, painted as `#3`; null before one is assigned. */
	number: string | null;
	status: ToolChecklistStatus;
	subject: string;
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
	| { items: readonly ToolChecklistItem[]; kind: 'checklist' }
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

/**
 * Everything a presenter decides. The glyph normally follows from the tool's
 * name, so it stays optional here; a presenter sets it only to override that
 * default, e.g. an image `read` marking itself distinctly from a text one.
 */
export type ToolPresenterResult = Omit<ToolPresentation, 'glyph'> & {
	glyph?: ToolGlyph;
};
