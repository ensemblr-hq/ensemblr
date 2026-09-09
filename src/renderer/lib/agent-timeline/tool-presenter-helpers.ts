import type { BundledLanguage } from 'shiki';
import { buildToolDiffRows } from '@/renderer/lib/diff/tool-rows';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import type {
	ToolBadgeDescriptor,
	ToolBodyDescriptor,
} from '@/renderer/types/tool-presentation';
import { classifyToolOutput } from './tool-output-classifier';

/** Matches an ANSI colour escape, which only the terminal body can render. */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`);

/**
 * Builds the chip that pins a tool's target path to its row, trimmed so the same
 * file resolves against the workspace tree whichever tool named it.
 * @param path - Path the tool operated on, or null when it named none
 * @param kind - Whether the path is a file or a directory
 * @param counts - Added and removed line counts; either side may be null when
 * the tool reports only one, as a fresh write does
 * @returns The badge, or null when there is no path to pin
 */
export function fileBadge(
	path: string | null,
	kind: 'file' | 'folder' = 'file',
	counts: { additions: number | null; deletions: number | null } | null = null,
): ToolBadgeDescriptor | null {
	const named = path?.trim() ?? '';
	if (named.length === 0) {
		return null;
	}
	return {
		additions: counts?.additions ?? null,
		deletions: counts?.deletions ?? null,
		kind,
		path: named,
	};
}

/**
 * Counts added and deleted rows from the parsed hunks a diff body renders.
 * @param patch - Unified diff text
 * @returns Added and deleted line totals
 */
export function patchCounts(patch: string): {
	additions: number;
	deletions: number;
} {
	const { rows } = buildToolDiffRows(patch);
	return {
		additions: rows.filter((row) => row.kind === 'insert').length,
		deletions: rows.filter((row) => row.kind === 'delete').length,
	};
}

/**
 * Resolves the Shiki grammar for a path, falling back to plain text.
 * @param path - Path whose extension picks the grammar, or null when unknown
 * @returns The Shiki language to highlight with
 */
export function languageFor(path: string | null): BundledLanguage {
	return path ? languageForFilePath(path) : ('text' as BundledLanguage);
}

/**
 * Picks the body for free-form output: the terminal only when the payload
 * carries ANSI colour, otherwise the shared code surface.
 * @param text - The tool's output text
 * @param language - Shiki grammar for the non-ANSI case
 * @returns The matching body descriptor
 */
export function textBody(
	text: string,
	language: BundledLanguage,
): ToolBodyDescriptor {
	if (ANSI_ESCAPE.test(text)) {
		return { kind: 'terminal', text };
	}
	return { code: text, kind: 'code', language, startLine: null };
}

/**
 * Projects a classifier result into the timeline's standard output bodies.
 * @param toolName - Tool name used to infer the output format
 * @param text - Non-empty output to classify
 * @returns Stack-trace, terminal, or syntax-highlighted body
 */
export function classifiedToolOutputBody(
	toolName: string,
	text: string,
): ToolBodyDescriptor {
	const classification = classifyToolOutput(toolName, text);
	if (classification.kind === 'stack-trace') {
		return { kind: 'stack-trace', trace: classification.text };
	}
	if (classification.kind === 'terminal') {
		return { kind: 'terminal', text: classification.text };
	}
	return textBody(
		classification.text,
		classification.kind === 'json'
			? ('json' as BundledLanguage)
			: (classification.language ?? ('text' as BundledLanguage)),
	);
}

/**
 * Projects structured tool output while validating compact JSON containers.
 * @param toolName - Tool name used to infer non-JSON output formats
 * @param text - Tool output to project
 * @returns Empty, JSON, stack-trace, terminal, or syntax-highlighted body
 */
export function structuredToolOutputBody(
	toolName: string,
	text: string,
): ToolBodyDescriptor {
	if (text.length === 0) {
		return { kind: 'empty' };
	}
	const trimmed = text.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			JSON.parse(trimmed);
			return textBody(text, 'json' as BundledLanguage);
		} catch {
			return textBody(text, 'text' as BundledLanguage);
		}
	}
	return classifiedToolOutputBody(toolName, text);
}
