import type { BundledLanguage } from 'shiki';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import type {
	ToolBadgeDescriptor,
	ToolBodyDescriptor,
} from '@/renderer/types/tool-presentation';

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
