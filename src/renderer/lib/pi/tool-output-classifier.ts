import type { BundledLanguage } from 'shiki';

/**
 * Discriminated kind for a tool output payload. The renderer maps each kind to
 * a dedicated AI Elements view so classification logic lives outside the
 * render path and is testable in isolation.
 */
export type ToolOutputKind =
	| 'stack-trace'
	| 'terminal'
	| 'code'
	| 'path-tree'
	| 'json'
	| 'text';

/** Classification result for one tool output value. */
export interface ToolOutputClassification {
	kind: ToolOutputKind;
	/** Pre-stringified payload so callers do not repeat the work. */
	text: string;
	/** Shiki language for `kind: 'code'` outputs. */
	language?: BundledLanguage;
}

const STACK_FRAME_LINE = /(^|\n)\s*at\s+.+:\d+:\d+/;
const ERROR_NAME_PREFIX = /(^|\n)\w*Error:/;
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`);
const SHELL_PROMPT_LINE = /(^|\n)[$>]\s+\w+/;
const PATH_TREE_LINE = /(^|\n)\s*(?:[├└]──|[-*]\s+)?[\w.-]+\//;
const CODE_FENCE_START = /^```/;
const DIFF_GIT_HEADER = /^diff --git /m;
const CODE_KEYWORD =
	/\b(import|export|function|const|class|interface|return|async|await|let|throw)\b/g;
const MIN_CODE_KEYWORD_HITS = 3;
const INTERFACE_DECLARATION = /\binterface\s+\w+/;
const JSX_TAG_OPEN = /<[A-Z][\w]*[\s>]/;
const JSON_OBJECT_START = /^[\s\n]*[{[]/;
/** `ls -l` style permission column: `drwxr-xr-x@ 25 user staff ...`. */
const LS_LONG_FORMAT = /(^|\s)[bcdlps-][rwxsStT-]{8,9}[@+]?\s+\d+\s+\S+\s+\S+/;
/** `total 96` header emitted by `ls -l`. */
const LS_TOTAL_HEADER = /(^|\n)total\s+\d+(\s|$)/;
/**
 * Run of `key: "value"` / `key: 123` / `key: null` pairs — session-state and
 * frontmatter-like dumps that must never hit the markdown renderer (Streamdown
 * inflates them into headings/bold soup).
 */
const STRUCTURED_KV_PAIR = /\b\w+:\s*(?:"[^"\n]*"|null|true|false|-?\d[\d.]*)/g;
const MIN_STRUCTURED_KV_HITS = 3;

/** Converts arbitrary tool payloads into readable text without throwing. */
export function stringifyToolValue(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/** Detects Node-style stack traces or error dumps in a text payload. */
export function looksLikeStackTrace(text: string): boolean {
	return STACK_FRAME_LINE.test(text) || ERROR_NAME_PREFIX.test(text);
}

function looksLikeTerminalOutput(toolName: string, text: string): boolean {
	const normalizedName = toolName.toLowerCase();
	return (
		normalizedName.includes('bash') ||
		normalizedName.includes('shell') ||
		normalizedName.includes('terminal') ||
		ANSI_ESCAPE.test(text) ||
		SHELL_PROMPT_LINE.test(text) ||
		LS_LONG_FORMAT.test(text) ||
		LS_TOTAL_HEADER.test(text)
	);
}

/**
 * True for `key: "value"` session-state dumps (chatTabId/piSessionId/...)
 * that read as data, not prose. Exported so the message-text segmenter can
 * fence single-paragraph dumps that would otherwise stay markdown.
 */
function looksLikeStructuredDump(text: string): boolean {
	const hits = (text.match(STRUCTURED_KV_PAIR) ?? []).length;
	return hits >= MIN_STRUCTURED_KV_HITS;
}

function looksLikeCodeOutput(toolName: string, text: string): boolean {
	const normalizedName = toolName.toLowerCase();
	if (normalizedName.includes('code') || normalizedName.includes('file')) {
		return true;
	}
	const trimmed = text.trim();
	if (CODE_FENCE_START.test(trimmed) || DIFF_GIT_HEADER.test(trimmed)) {
		return true;
	}
	const keywordHits = (trimmed.match(CODE_KEYWORD) ?? []).length;
	return keywordHits >= MIN_CODE_KEYWORD_HITS;
}

function looksLikePathTree(text: string): boolean {
	return PATH_TREE_LINE.test(text);
}

/** Infers a Shiki language for `kind: 'code'` outputs. */
function inferCodeLanguage(toolName: string, text: string): BundledLanguage {
	const lowerText = text.toLowerCase();
	const lowerTool = toolName.toLowerCase();
	if (DIFF_GIT_HEADER.test(text) || lowerTool.includes('patch')) {
		return 'diff' as BundledLanguage;
	}
	if (lowerText.includes('tsx') || JSX_TAG_OPEN.test(text)) {
		return 'tsx' as BundledLanguage;
	}
	if (lowerText.includes('typescript') || INTERFACE_DECLARATION.test(text)) {
		return 'typescript' as BundledLanguage;
	}
	if (lowerText.includes('json') || JSON_OBJECT_START.test(text)) {
		return 'json' as BundledLanguage;
	}
	if (lowerText.includes('bash') || lowerTool.includes('shell')) {
		return 'bash' as BundledLanguage;
	}
	if (lowerText.includes('markdown') || lowerTool.includes('readme')) {
		return 'markdown' as BundledLanguage;
	}
	return 'typescript' as BundledLanguage;
}

/**
 * Classifies a tool output value once so the renderer can dispatch to the
 * right AI Elements view via a typed `switch`.
 */
export function classifyToolOutput(
	toolName: string,
	value: unknown,
): ToolOutputClassification {
	const text = stringifyToolValue(value);

	if (looksLikeStackTrace(text)) {
		return { kind: 'stack-trace', text };
	}
	if (looksLikeTerminalOutput(toolName, text)) {
		return { kind: 'terminal', text };
	}
	if (looksLikeCodeOutput(toolName, text)) {
		return { kind: 'code', language: inferCodeLanguage(toolName, text), text };
	}
	if (looksLikePathTree(text)) {
		return { kind: 'path-tree', text };
	}
	if (looksLikeStructuredDump(text)) {
		return { kind: 'json', text };
	}
	if (typeof value === 'object' && value !== null) {
		return { kind: 'json', text };
	}
	return { kind: 'text', text };
}
