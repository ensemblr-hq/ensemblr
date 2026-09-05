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
	| 'eye'
	| 'file-diff'
	| 'file-pen'
	| 'file-plus'
	| 'file-text'
	| 'folder-tree'
	| 'git-branch-plus'
	| 'hourglass'
	| 'image'
	| 'kanban'
	| 'keyboard'
	| 'list'
	| 'message-circle-question'
	| 'message-square-check'
	| 'message-square-plus'
	| 'message-square-text'
	| 'network'
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
	| 'ticket-plus'
	| 'wrench';

/**
 * Which transcript a row is being rendered in. The app's own control tools mean
 * different things on the two: what a workspace agent spawns is a sub-agent that
 * reports back to it, while what the Concierge spawns is a chat in a workspace
 * the user can talk to themselves.
 */
export type TimelineSurface = 'concierge' | 'workspace';

/** The file a row touched, pinned beside its title. */
export interface ToolFileBadgeDescriptor {
	/** Added-line count for an edit; null when the tool reports no diff. */
	additions: number | null;
	deletions: number | null;
	kind: 'file' | 'folder';
	path: string;
}

/**
 * The workspace a control call acted on. Only the id travels: the name the chip
 * paints is read from the app's live catalogue, so a workspace renamed since the
 * row was written reads by its current name rather than by the one it had then.
 */
export interface ToolWorkspaceBadgeDescriptor {
	kind: 'workspace';
	workspaceId: string;
}

/**
 * The chat a control call opened, steered, or closed. Carries the id for the
 * same reason a workspace badge does — a chat is renamed by the agent working in
 * it, often seconds after the row that started it was written.
 */
export interface ToolChatBadgeDescriptor {
	chatTabId: string;
	kind: 'chat';
	/**
	 * Workspace holding the chat, pinned instead when the chat itself cannot be
	 * resolved. A tab nobody has named yet is deliberately absent from the
	 * catalogue, and that is exactly the state a spawn row is written in — so
	 * without this the row that just started a chat would carry no chip at all.
	 */
	workspaceId: string | null;
}

/**
 * Persistent chip pinned beside a tool title. Unlike a preview it survives
 * expansion, so what the row is about stays on screen while its body reads.
 */
export type ToolBadgeDescriptor =
	| ToolChatBadgeDescriptor
	| ToolFileBadgeDescriptor
	| ToolWorkspaceBadgeDescriptor;

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
	/**
	 * Title to fall back to when the badge pins nothing on screen, which only a
	 * chat or workspace badge can do — those resolve against a live catalogue and
	 * come up empty for something archived, deleted, or not listed yet.
	 *
	 * A row that hands its subject to a chip keeps it out of the title so the two
	 * do not say the same thing twice; this is that subject put back, so the
	 * fallback is a plainer row rather than a row that names nothing.
	 */
	unpinnedTitle?: string;
}

/**
 * Everything a presenter decides. The glyph normally follows from the tool's
 * name, so it stays optional here; a presenter sets it only to override that
 * default, e.g. an image `read` marking itself distinctly from a text one.
 */
export type ToolPresenterResult = Omit<ToolPresentation, 'glyph'> & {
	glyph?: ToolGlyph;
};
